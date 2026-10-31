import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import { readEnv } from "@/lib/env";
import { maskOutline, type Point } from "@/lib/images/geometry";
import { createResponse, type CallOptions, type CallResult } from "@/lib/meta/client";
import type { BBox } from "@/lib/schemas/evidence";

// SAM 3.1 on Meta Model API: a short noun phrase plus one image in, every match
// back as a box and a mask. Masks are decoded with Meta's @meta-sam/parser (its
// base85 payload can contain "|>", so no regex can find where a mask ends) and
// kept only as an outline polygon.
// Grammar: https://dev.meta.ai/docs/sam/reading-segmentation

export type SamBox = { id: number; bbox: BBox; confidence: number | null };
export type SamObject = SamBox & { outline: Point[] };

const RECORD = /(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([\d.]+))?\|>/g;

/** Boxes from the first frame line (an image is always frame <0f>), normalized to 0-1. */
export function parseSamBoxes(text: string): SamBox[] {
  const line = text.split("\n").find((l) => l.startsWith("<0f>")) ?? "";
  const boxes: SamBox[] = [];
  for (const m of line.matchAll(RECORD)) {
    const [x1, y1, x2, y2, w, h] = m.slice(2, 8).map(Number);
    if (!w || !h || x2 <= x1 || y2 <= y1) continue;
    boxes.push({
      id: Number(m[1]),
      bbox: { x0: x1 / w, y0: y1 / h, x1: x2 / w, y1: y2 / h },
      confidence: m[8] === undefined ? null : Number(m[8]),
    });
  }
  return boxes;
}

/** Boxes plus each mask's outline. An object whose mask is missing or empty is outlined by its box. */
export async function parseSamObjects(text: string): Promise<SamObject[]> {
  const boxes = parseSamBoxes(text);
  const frame = /;w=(\d+);h=(\d+)/.exec(text);
  if (!boxes.length || !frame) return [];
  const size = { w: Number(frame[1]), h: Number(frame[2]) };
  async function* events() {
    const lane = { item_id: "sam", output_index: 0, content_index: 0 };
    yield { type: "response.output_text.delta" as const, delta: text, ...lane };
    yield { type: "response.output_text.done" as const, text, ...lane };
    yield { type: "response.completed" as const };
  }
  const parsed = parseImageStream(events());
  // Drain the snapshots; only the final result matters.
  for await (const snapshot of parsed) void snapshot;
  const masks = new Map(recordsOfKind((await parsed.finalResult).records, "mask").map((m) => [Number(m.objectId), m]));
  return boxes.map((b) => {
    const m = masks.get(b.id);
    const outline = m ? maskOutline(decodeMaskToRaster(m.mask), m.mask.width, m.mask.height, m.bounds, size) : [];
    const { x0, y0, x1, y1 } = b.bbox;
    return {
      ...b,
      outline: outline.length >= 3 ? outline : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], // prettier-ignore
    };
  });
}

export async function segmentImage(
  imageUrl: string,
  phrase: string,
  opts: Omit<CallOptions, "task"> & { task?: string } = {},
): Promise<{ objects: SamObject[]; call: CallResult }> {
  const env = opts.env ?? readEnv();
  const call = await createResponse(
    {
      model: env.SAM_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: phrase },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
      metadata: { include_confidence: "true", mask_encoding: "one_bit" },
    },
    { ...opts, env, task: opts.task ?? "sam_segment" },
  );
  return { objects: await parseSamObjects(call.outputText), call };
}
