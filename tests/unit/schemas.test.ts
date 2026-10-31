import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { cropObjects } from "@/lib/images/crop";
import { maskOutline, pointInPolygon } from "@/lib/images/geometry";
import { preparePhoto, readExif } from "@/lib/images/prepare";
import { parseSamBoxes, parseSamObjects } from "@/lib/meta/sam";
import { MemoryCounterStore, SpendGuard } from "@/lib/meta/spend";
import { runTask, TaskFailed, toStrictJsonSchema } from "@/lib/meta/task";
import { normalizeBox, toEvidence } from "@/lib/schemas/evidence";
import {
  NotesExtraction,
  ScheduleExtraction,
  SyllabusPageExtraction,
  WhiteboardExtraction,
} from "@/lib/schemas/extraction";

function objects(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) node.forEach((n) => objects(n, out));
  else if (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    if (n.type === "object") out.push(n);
    Object.values(n).forEach((v) => objects(v, out));
  }
  return out;
}

describe("toStrictJsonSchema", () => {
  for (const [name, schema] of Object.entries({
    ScheduleExtraction,
    SyllabusPageExtraction,
    WhiteboardExtraction,
    NotesExtraction,
  })) {
    it(`${name} fits Meta's strict subset`, () => {
      const json = toStrictJsonSchema(schema);
      expect(json.$schema).toBeUndefined();
      expect(json.type).toBe("object");
      const text = JSON.stringify(json);
      expect(text).not.toContain('"oneOf"');
      expect(text).not.toContain('"allOf"');
      for (const o of objects(json)) {
        expect(o.additionalProperties).toBe(false);
        expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort());
      }
    });
  }
});

describe("evidence", () => {
  it("converts the 0-1000 grid to 0-1", () => {
    expect(normalizeBox({ x_min: 100, y_min: 200, x_max: 500, y_max: 250 })).toEqual({
      x0: 0.1,
      y0: 0.2,
      x1: 0.5,
      y1: 0.25,
    });
  });
  it("drops a degenerate box", () => {
    expect(normalizeBox({ x_min: 500, y_min: 200, x_max: 500, y_max: 250 })).toBeNull();
    expect(normalizeBox({ x_min: 600, y_min: 200, x_max: 500, y_max: 250 })).toBeNull();
  });
  it("adds source and page", () => {
    expect(toEvidence({ quote: "Quiz 3, Fri Oct 30", box: null }, "src_1", 2)).toEqual({
      source_id: "src_1",
      page: 2,
      bbox: null,
      quote: "Quiz 3, Fri Oct 30",
    });
  });
});

describe("parseSamBoxes", () => {
  it("reads the documented image example", () => {
    const line =
      "<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,101,~ab|>,2<|box;x1=516;y1=117;x2=536;y2=150;w=537;h=561;c=0.9|><|mask;x=0;y=0;c=0.9;data=34,21,~cd|>";
    const boxes = parseSamBoxes(line);
    expect(boxes.map((b) => b.id)).toEqual([0, 2]);
    expect(boxes[0].bbox.x0).toBeCloseTo(353 / 537);
    expect(boxes[0].confidence).toBeNull();
    expect(boxes[1].confidence).toBe(0.9);
  });
  it("treats empty output as no matches", () => {
    expect(parseSamBoxes("")).toEqual([]);
  });
});

describe("parseSamObjects", () => {
  // From @meta-sam/parser's README: frame 0 of a 320x334 image, two objects, lossless masks.
  const text =
    "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>" +
    "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
    ",1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>" +
    "<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n";
  it("decodes each mask to an outline inside its box (to the pixel: box corners are inclusive)", async () => {
    const objects = await parseSamObjects(text);
    expect(objects.map((o) => o.id)).toEqual([0, 1]);
    for (const o of objects) {
      expect(o.outline.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of o.outline) {
        expect(x).toBeGreaterThanOrEqual(o.bbox.x0 - 0.004);
        expect(x).toBeLessThanOrEqual(o.bbox.x1 + 0.004);
        expect(y).toBeGreaterThanOrEqual(o.bbox.y0 - 0.004);
        expect(y).toBeLessThanOrEqual(o.bbox.y1 + 0.004);
      }
    }
  });
  it("treats empty output as no objects", async () => {
    expect(await parseSamObjects("")).toEqual([]);
  });
});

describe("outlines and object crops", () => {
  it("outlines a mask in image coordinates", () => {
    // A 4x4 raster with a 2x2 block in the middle, covering pixels 10-14 of a 20x20 image.
    const raster = new Uint8Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    const outline = maskOutline(raster, 4, 4, { left: 10, top: 10, right: 14, bottom: 14 }, { w: 20, h: 20 });
    expect(outline).toHaveLength(4);
    expect(pointInPolygon([0.6, 0.6], outline)).toBe(true);
    expect(pointInPolygon([0.52, 0.52], outline)).toBe(false);
  });
  it("paints everything outside the object white", async () => {
    const c = createCanvas(100, 100);
    const g = c.getContext("2d");
    g.fillStyle = "#ff0000";
    g.fillRect(0, 0, 100, 100);
    const [png] = await cropObjects(new Uint8Array(c.toBuffer("image/png")), [
      { bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, outline: [[0, 0], [1, 0], [0, 1]] }, // prettier-ignore
    ]);
    const img = await loadImage(Buffer.from(png));
    const out = createCanvas(img.width, img.height);
    out.getContext("2d").drawImage(img, 0, 0);
    const px = (x: number, y: number) => [...out.getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)];
    expect(px(10, 10)).toEqual([255, 0, 0]); // inside the triangle
    expect(px(90, 90)).toEqual([255, 255, 255]); // outside it
  });
});

describe("runTask", () => {
  const env = readEnv({ META_API_KEY: "k" });
  const reply = (text: string) =>
    new Response(
      JSON.stringify({
        id: "r",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text }] }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  const task = {
    name: "t",
    version: 1,
    instructions: "x",
    schema: z.object({ n: z.int() }),
    check: (o: { n: number }) => (o.n > 0 ? null : "n must be positive"),
  };

  it("sends the problem back once and accepts the fix", async () => {
    const bodies: unknown[] = [];
    const replies = [reply('{"n":0}'), reply('{"n":3}')];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return replies.shift()!;
    }) as unknown as typeof fetch;
    const r = await runTask(task, [{ type: "input_text", text: "hi" }], {
      env,
      fetchImpl,
      guard: new SpendGuard(new MemoryCounterStore(), 1),
      log: () => {},
    });
    expect(r.data.n).toBe(3);
    expect(r.calls).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).toContain("n must be positive");
    expect((bodies[0] as { text: { format: { strict: boolean } } }).text.format.strict).toBe(true);
  });

  it("fails after the second bad answer", async () => {
    const replies = [reply("not json"), reply('{"n":-1}')];
    const fetchImpl = (async () => replies.shift()!) as unknown as typeof fetch;
    await expect(
      runTask(task, [{ type: "input_text", text: "hi" }], {
        env,
        fetchImpl,
        guard: new SpendGuard(new MemoryCounterStore(), 1),
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(TaskFailed);
  });
});

describe("phone photos", () => {
  /** A JPEG with an EXIF block: Orientation, and DateTimeOriginal with its offset, little-endian. */
  async function jpegWithExif(orientation: number, taken: string, offset: string) {
    const c = createCanvas(40, 20); // wide: rotating it makes it tall
    c.getContext("2d").fillRect(0, 0, 40, 20);
    const jpeg = new Uint8Array(c.toBuffer("image/jpeg"));
    const ascii = (t: string) => [...t].map((ch) => ch.charCodeAt(0)).concat(0);
    const u16 = (n: number) => [n & 0xff, n >> 8];
    const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
    const entry = (tag: number, type: number, count: number, value: number[]) => [
      ...u16(tag), ...u16(type), ...u32(count), ...value, ...Array(4 - value.length).fill(0),
    ]; // prettier-ignore
    // TIFF header (8) + IFD0 with 2 entries (2 + 24 + 4) = 38; Exif IFD with 2 entries (2 + 24 + 4) = 30; then strings.
    const exifIfd = 38;
    const takenAt = exifIfd + 30;
    const offsetAt = takenAt + ascii(taken).length;
    const tiff = [
      0x49, 0x49, ...u16(42), ...u32(8),
      ...u16(2), ...entry(0x0112, 3, 1, u16(orientation)), ...entry(0x8769, 4, 1, u32(exifIfd)), ...u32(0),
      ...u16(2), ...entry(0x9003, 2, ascii(taken).length, u32(takenAt)), ...entry(0x9011, 2, ascii(offset).length, u32(offsetAt)), ...u32(0),
      ...ascii(taken), ...ascii(offset),
    ]; // prettier-ignore
    const app1 = [
      0xff,
      0xe1,
      ...[(tiff.length + 8) >> 8, (tiff.length + 8) & 0xff],
      0x45,
      0x78,
      0x69,
      0x66,
      0,
      0,
      ...tiff,
    ];
    return new Uint8Array([...jpeg.slice(0, 2), ...app1, ...jpeg.slice(2)]);
  }

  it("reads when it was taken, with its offset", async () => {
    const bytes = await jpegWithExif(6, "2026:10:28 10:51:02", "-04:00");
    expect(readExif(bytes)).toEqual({ orientation: 6, takenAt: "2026-10-28T10:51:02-04:00" });
    expect(readExif(new Uint8Array([1, 2, 3]))).toEqual({ orientation: 1, takenAt: null });
  });
  it("turns it upright and keeps the capture time", async () => {
    const p = await preparePhoto(await jpegWithExif(6, "2026:10:28 10:51:02", "-04:00"));
    expect([p.width, p.height]).toEqual([20, 40]);
    expect(p.takenAt).toBe("2026-10-28T10:51:02-04:00");
    expect(readExif(p.bytes).takenAt).toBeNull(); // the re-encoded JPEG carries no EXIF (no location either)
  });
});
