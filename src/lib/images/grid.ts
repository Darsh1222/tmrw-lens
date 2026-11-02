import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { ModelBox } from "@/lib/schemas/evidence";
import type { ScheduleExtraction } from "@/lib/schemas/extraction";

// A schedule grid, measured in code. The model says roughly where each class
// block and hour label is; its boxes can be 20 or 30 pixels off, which is 15
// minutes on a grid. Code then finds the exact edges in the pixels: each block
// is a run of one colour, so it grows from a point inside the model's box until
// the colour changes; each hour label belongs to the nearest grid line (a row of
// light grey across the grid), or failing that sits at the middle of its ink.
// Times are worked out from these later (gridTimes in src/lib/plan/candidates.ts).
// Where a measurement fails, the model's box stands.

type Pixels = { data: Uint8ClampedArray; width: number; height: number };

const at = (p: Pixels, x: number, y: number) => {
  const i = (Math.round(y) * p.width + Math.round(x)) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2]] as const;
};
const luma = ([r, g, b]: readonly number[]) => 0.299 * r + 0.587 * g + 0.114 * b;
const near = (a: readonly number[], b: readonly number[], tol = 36) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= tol;
const clampY = (p: Pixels, y: number) => Math.max(0, Math.min(p.height - 1, y));

/** A block's colour: not the page, not a grid line or text (those are grey). */
const isBlock = (c: readonly number[]) => luma(c) < 248 && Math.max(...c) - Math.min(...c) >= 15;

/**
 * A block's exact top and bottom rows: the longest run of one block colour through points spread over the model's
 * box (its box can be off sideways too, and a column through text is broken up by it).
 */
export function blockEdges(p: Pixels, box: ModelBox): { top: number; bottom: number } | null {
  const px = (v: number, size: number) => (v / 1000) * size;
  const x0 = px(box.x_min, p.width);
  const x1 = px(box.x_max, p.width);
  const y0 = px(box.y_min, p.height);
  const y1 = px(box.y_max, p.height);
  const h = y1 - y0;
  if (x1 - x0 < 4 || h < 4) return null;
  // Never further than half the model's height past its box: two same-coloured blocks back to back stay two.
  const lo = clampY(p, y0 - h / 2);
  const hi = clampY(p, y1 + h / 2);
  let best: { top: number; bottom: number } | null = null;
  for (const fx of [0.75, 0.6, 0.85, 0.5, 0.4, 0.3, 0.95])
    for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const x = Math.min(p.width - 1, Math.max(0, x0 + fx * (x1 - x0)));
      const seed = clampY(p, y0 + fy * h);
      const colour = at(p, x, seed);
      if (!isBlock(colour)) continue;
      let top = seed;
      while (top - 1 >= lo && near(at(p, x, top - 1), colour)) top--;
      let bottom = seed;
      while (bottom + 1 <= hi && near(at(p, x, bottom + 1), colour)) bottom++;
      if (!best || bottom + 1 - top > best.bottom - best.top) best = { top, bottom: bottom + 1 };
    }
  return best;
}

/** Rows that are a grid line: light grey, not a block's colour, across at least a third of the grid's width. */
export function gridLines(p: Pixels, fromX: number): number[] {
  const rows: number[] = [];
  const span = p.width - fromX;
  if (span < 20) return rows;
  for (let y = 0; y < p.height; y++) {
    let line = 0;
    for (let x = Math.round(fromX); x < p.width; x += 2) {
      const c = at(p, x, y);
      const l = luma(c);
      const grey = Math.max(...c) - Math.min(...c) < 12;
      if (grey && l >= 150 && l <= 245) line++;
    }
    if (line * 2 >= span / 3) rows.push(y);
  }
  // A line drawn between two rows shows as two; each run of rows is one line, at its middle.
  const lines: number[] = [];
  let run: number[] = [];
  for (const y of [...rows, Infinity]) {
    if (run.length && y !== run.at(-1)! + 1) {
      lines.push((run[0] + run.at(-1)!) / 2);
      run = [];
    }
    if (Number.isFinite(y)) run.push(y);
  }
  return lines;
}

/** The middle of a label's ink, searched within `reach` rows of where the model put it. */
function inkMiddle(p: Pixels, box: ModelBox, reach: number): number | null {
  const x0 = Math.max(0, Math.round((box.x_min / 1000) * p.width) - 8);
  const x1 = Math.min(p.width - 1, Math.round((box.x_max / 1000) * p.width) + 8);
  const mid = (((box.y_min + box.y_max) / 2) * p.height) / 1000;
  const runs: [number, number][] = [];
  let start: number | null = null;
  for (let y = Math.round(clampY(p, mid - reach)); y <= clampY(p, mid + reach); y++) {
    let ink = false;
    for (let x = x0; x <= x1 && !ink; x++) ink = luma(at(p, x, y)) < 170;
    if (ink && start === null) start = y;
    if (!ink && start !== null) {
      runs.push([start, y - 1]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, Math.round(clampY(p, mid + reach))]);
  if (!runs.length) return null;
  const centre = (r: [number, number]) => (r[0] + r[1]) / 2;
  return centre(runs.reduce((a, b) => (Math.abs(centre(b) - mid) < Math.abs(centre(a) - mid) ? b : a)));
}

const toModel = (px: number, size: number) => Math.max(0, Math.min(1000, Math.round((px / size) * 1000)));

/** The extraction with each block's and hour label's vertical position measured from the pixels. */
export function measureGridPixels(p: Pixels, extraction: ScheduleExtraction): ScheduleExtraction {
  if (extraction.view !== "grid") return extraction;
  const axis = extraction.time_axis ?? [];
  const middles = axis.flatMap((l) => (l.evidence.box ? [((l.evidence.box.y_min + l.evidence.box.y_max) / 2 / 1000) * p.height] : [])); // prettier-ignore
  const gaps = middles
    .slice(1)
    .map((m, i) => m - middles[i])
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
  const spacing = gaps.length ? gaps[Math.floor(gaps.length / 2)] : p.height / 12;
  const axisRight = Math.max(0, ...axis.map((l) => ((l.evidence.box?.x_max ?? 0) / 1000) * p.width));
  const lines = gridLines(p, axisRight + 8);

  const time_axis = axis.map((l) => {
    const b = l.evidence.box;
    if (!b) return l;
    const ink = inkMiddle(p, b, spacing / 2);
    const guess = ink ?? (((b.y_min + b.y_max) / 2) * p.height) / 1000;
    const line = lines.reduce<number | null>((a, y) => (a === null || Math.abs(y - guess) < Math.abs(a - guess) ? y : a), null); // prettier-ignore
    const y = line !== null && Math.abs(line - guess) < spacing / 3 ? line : ink;
    if (y === null) return l;
    const half = (b.y_max - b.y_min) / 2;
    const m = toModel(y, p.height);
    return {
      ...l,
      evidence: { ...l.evidence, box: { ...b, y_min: Math.round(m - half), y_max: Math.round(m + half) } },
    };
  });

  const classes = extraction.classes.map((c) => {
    if (!c.block) return c;
    const e = blockEdges(p, c.block);
    return e ? { ...c, block: { ...c.block, y_min: toModel(e.top, p.height), y_max: toModel(e.bottom, p.height) } } : c;
  });
  return { ...extraction, time_axis, classes };
}

export async function measureGrid(image: Uint8Array, extraction: ScheduleExtraction): Promise<ScheduleExtraction> {
  if (extraction.view !== "grid") return extraction;
  const img = await loadImage(Buffer.from(image));
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, img.width, img.height);
  return measureGridPixels({ data, width: img.width, height: img.height }, extraction);
}
