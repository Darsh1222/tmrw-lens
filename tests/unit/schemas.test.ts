import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { parseSamBoxes } from "@/lib/meta/sam";
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
