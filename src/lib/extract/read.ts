import type { CallOptions, CallResult, ContentPart } from "@/lib/meta/client";
import { runTask } from "@/lib/meta/task";
import { rereadTask, taskFor } from "@/lib/extract/tasks";
import { cropBoxes } from "@/lib/images/crop";
import type { PageReading, Reread, SourceMeta, SourceReading } from "@/lib/plan/types";
import { normalizeBox, type BBox, type ModelEvidence } from "@/lib/schemas/evidence";

// Reads one source with Muse Spark: one extraction call per page (or per photo,
// or for the pasted text), then, for pages without their own text, one call
// that re-reads every quote's box from a crop.

export type PageInput = {
  page: number | null;
  /** PNG or JPEG bytes; null for pasted text. */
  image: Uint8Array | null;
  mime?: "image/png" | "image/jpeg";
  /** Pasted text, or the PDF page's text layer. */
  text: string | null;
};

type Opts = Omit<CallOptions, "task">;

const MAX_CROPS = 24;

export function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Every quote in an extraction with the key the plan builder looks its re-read up by. */
export function quotesOf(extraction: PageReading["extraction"]): { key: string; evidence: ModelEvidence }[] {
  const out: { key: string; evidence: ModelEvidence }[] = [];
  if ("classes" in extraction)
    extraction.classes.forEach((c, i) => out.push({ key: `classes.${i}`, evidence: c.evidence }));
  if ("items" in extraction)
    extraction.items.forEach((it, i) => out.push({ key: `items.${i}`, evidence: it.evidence }));
  if ("term_start" in extraction && extraction.term_start)
    out.push({ key: "term_start", evidence: extraction.term_start.evidence });
  return out;
}

export async function rereadPage(
  image: Uint8Array,
  extraction: PageReading["extraction"],
  opts: Opts,
): Promise<{ rereads: Record<string, Reread>; calls: CallResult[] }> {
  const boxed = quotesOf(extraction)
    .map((q) => ({ key: q.key, bbox: q.evidence.box ? normalizeBox(q.evidence.box) : null }))
    .filter((q): q is { key: string; bbox: BBox } => q.bbox !== null);
  const rereads: Record<string, Reread> = {};
  const calls: CallResult[] = [];
  for (let start = 0; start < boxed.length; start += MAX_CROPS) {
    const batch = boxed.slice(start, start + MAX_CROPS);
    const crops = await cropBoxes(
      image,
      batch.map((b) => b.bbox),
    );
    const content: ContentPart[] = crops.flatMap((png, i) => [
      { type: "input_text" as const, text: `Crop ${i + 1}:` },
      { type: "input_image" as const, image_url: dataUrl(png, "image/png") },
    ]);
    const { data, calls: c } = await runTask(rereadTask(batch.length), content, opts);
    calls.push(...c);
    for (const r of data.reads) {
      const b = batch[r.crop - 1];
      if (b) rereads[b.key] = { text: r.text, legible: r.legible };
    }
  }
  return { rereads, calls };
}

export async function readSource(
  source: SourceMeta,
  pages: PageInput[],
  opts: Opts = {},
): Promise<{ reading: SourceReading; calls: CallResult[] }> {
  const task = taskFor(source.kind);
  const calls: CallResult[] = [];
  const out: PageReading[] = [];
  for (const p of pages) {
    const content: ContentPart[] = p.image
      ? [{ type: "input_image", image_url: dataUrl(p.image, p.mime ?? "image/png") }]
      : [{ type: "input_text", text: p.text ?? "" }];
    const { data, calls: c } = await runTask(task, content, opts);
    calls.push(...c);
    const extraction = data as PageReading["extraction"];
    let rereads: Record<string, Reread> = {};
    if (p.text === null && p.image) {
      const r = await rereadPage(p.image, extraction, opts);
      rereads = r.rereads;
      calls.push(...r.calls);
    }
    out.push({ page: p.page, text: p.text, extraction, rereads });
  }
  return { reading: { source, pages: out }, calls };
}
