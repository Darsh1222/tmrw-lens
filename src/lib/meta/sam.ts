import { readEnv } from "@/lib/env";
import { createResponse, type CallOptions, type CallResult } from "@/lib/meta/client";
import type { BBox } from "@/lib/schemas/evidence";

// SAM 3.1 on Meta Model API: a short noun phrase plus one image in, every match
// back as a box (and a mask Lens doesn't use yet). Only boxes are parsed here.
// Grammar: https://dev.meta.ai/docs/sam/reading-segmentation

export type SamBox = { id: number; bbox: BBox; confidence: number | null };

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

export async function segmentImage(
  imageUrl: string,
  phrase: string,
  opts: Omit<CallOptions, "task"> & { task?: string } = {},
): Promise<{ boxes: SamBox[]; call: CallResult }> {
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
  return { boxes: parseSamBoxes(call.outputText), call };
}
