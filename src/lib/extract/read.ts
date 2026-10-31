import type { CallOptions, CallResult, ContentPart } from "@/lib/meta/client";
import { segmentImage } from "@/lib/meta/sam";
import { runTask } from "@/lib/meta/task";
import { rereadTask, taskFor } from "@/lib/extract/tasks";
import { cropBoxes, cropObjects } from "@/lib/images/crop";
import { objectFor } from "@/lib/plan/objects";
import { rereadAgrees } from "@/lib/plan/verify";
import type { PageReading, Reread, SceneObject, SourceMeta, SourceReading } from "@/lib/plan/types";
import { normalizeBox, type BBox, type ModelEvidence, type ObjectLabel, type SourceKind } from "@/lib/schemas/evidence";

// Reads one source with Muse Spark: one extraction call per page (or per photo,
// or for the pasted text). On photos, SAM 3.1 then finds the objects (sticky
// notes, sheets, the board), and one more call re-reads every quote from a
// crop. A quote alone on its object (one sticky note) is re-read from the whole
// object; a quote that shares its object (a line on a board) from its own box,
// clipped to the object's outline. A whole board re-read in one go would be
// the same pixels as the first read, which checks much less. A line whose
// crop doesn't read back as its quote (the model's box was off) gets one more
// try from a band a few lines tall: as wide as its object, or the photo.

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

/** One SAM call per concept (SAM takes one per request). Below this confidence a match is dropped. */
const CONCEPTS: { phrase: string; label: ObjectLabel }[] = [
  { phrase: "sticky note", label: "sticky_note" },
  { phrase: "paper", label: "paper" },
  { phrase: "whiteboard", label: "whiteboard" },
];
const MIN_CONFIDENCE = 0.5;

export const SEGMENTED_KINDS: SourceKind[] = ["whiteboard_photo", "notes_photo"];

/** Bumped when how photos are segmented or cropped changes: recorded evals of photos are then re-read. */
export const CROP_VERSION = 3;

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
  if ("term_end" in extraction && extraction.term_end)
    out.push({ key: "term_end", evidence: extraction.term_end.evidence });
  if ("breaks" in extraction)
    (extraction.breaks ?? []).forEach((b, i) => out.push({ key: `breaks.${i}`, evidence: b.evidence }));
  return out;
}

export async function extractPage(
  kind: SourceKind,
  p: PageInput,
  opts: Opts,
): Promise<{ extraction: PageReading["extraction"]; calls: CallResult[] }> {
  const content: ContentPart[] = p.image
    ? [{ type: "input_image", image_url: dataUrl(p.image, p.mime ?? "image/png") }]
    : [{ type: "input_text", text: p.text ?? "" }];
  const { data, calls } = await runTask(taskFor(kind), content, opts);
  return { extraction: data as PageReading["extraction"], calls };
}

export async function segmentPage(
  image: Uint8Array,
  mime: string,
  opts: Opts,
): Promise<{ objects: SceneObject[]; calls: CallResult[] }> {
  const url = dataUrl(image, mime);
  const found: SceneObject[] = [];
  const calls: CallResult[] = [];
  // One request per concept, all at once; results are kept in CONCEPTS order, so the outcome doesn't depend on timing.
  const results = await Promise.all(
    CONCEPTS.map(({ phrase, label }) => segmentImage(url, phrase, { ...opts, task: `sam_${label}` })),
  );
  for (const [k, { objects, call }] of results.entries()) {
    const { label } = CONCEPTS[k];
    calls.push(call);
    for (const o of objects)
      if ((o.confidence ?? 1) >= MIN_CONFIDENCE)
        found.push({ id: `${label}_${o.id}`, label, bbox: o.bbox, outline: o.outline, confidence: o.confidence });
  }
  // Raw detections: which ones are the same thing is decided in code (dedupeObjects), so it can be re-tuned offline.
  return { objects: found, calls };
}

/** The second read. With `objects`, crops follow them as above; without, every quote is cropped from its box. */
export async function rereadPage(
  image: Uint8Array,
  extraction: PageReading["extraction"],
  opts: Opts,
  objects?: SceneObject[],
): Promise<{ rereads: Record<string, Reread>; calls: CallResult[] }> {
  const quotes = quotesOf(extraction)
    .map((q) => ({ key: q.key, bbox: q.evidence.box ? normalizeBox(q.evidence.box) : null }))
    .filter((q): q is { key: string; bbox: BBox } => q.bbox !== null)
    .map((q) => ({ ...q, object: objectFor(q.bbox, objects) }));
  const sharing = (o: SceneObject | null) => !!o && quotes.filter((q) => q.object?.id === o.id).length > 1;
  type Crop = { key: string; bbox: BBox; object: SceneObject | null; whole: boolean };
  const crops: Crop[] = quotes.map((q) => ({ ...q, whole: !!q.object && !sharing(q.object) }));

  const rereads: Record<string, Reread> = {};
  const calls: CallResult[] = [];
  const quoteOf = new Map(quotesOf(extraction).map((q) => [q.key, q.evidence.quote]));
  await readCrops(image, crops, opts, rereads, calls);
  // One targeted retry for lines that didn't read back: a taller band, so a box that's a line off still holds it.
  const missed = crops
    .filter((c) => !c.whole && !rereadAgrees(rereads[c.key]?.text ?? "", quoteOf.get(c.key) ?? ""))
    .map((c) => ({ ...c, bbox: band(c.bbox, c.object) }));
  await readCrops(image, missed, opts, rereads, calls);
  return { rereads, calls };
}

/** One and a half box-heights above and below; as wide as the object, or the photo when the quote is in none. */
function band(b: BBox, object: SceneObject | null): BBox {
  const h = b.y1 - b.y0;
  return {
    x0: object ? object.bbox.x0 : 0,
    x1: object ? object.bbox.x1 : 1,
    y0: Math.max(0, b.y0 - 1.5 * h),
    y1: Math.min(1, b.y1 + 1.5 * h),
  };
}

async function readCrops(
  image: Uint8Array,
  crops: { key: string; bbox: BBox; object: SceneObject | null; whole: boolean }[],
  opts: Opts,
  rereads: Record<string, Reread>,
  calls: CallResult[],
) {
  for (let start = 0; start < crops.length; start += MAX_CROPS) {
    const batch = crops.slice(start, start + MAX_CROPS);
    const pngs = await Promise.all(
      batch.map(async (c) =>
        (c.whole ? cropObjects(image, [c.object!]) : cropBoxes(image, [c.bbox], [c.object?.outline ?? null])).then(
          (r) => r[0],
        ),
      ),
    );
    const content: ContentPart[] = pngs.flatMap((png, i) => [
      { type: "input_text" as const, text: `Crop ${i + 1}:` },
      { type: "input_image" as const, image_url: dataUrl(png, "image/png") },
    ]);
    const { data, calls: c } = await runTask(rereadTask(batch.length), content, opts);
    calls.push(...c);
    for (const r of data.reads) {
      const crop = batch[r.crop - 1];
      if (crop) rereads[crop.key] = { text: r.text, legible: r.legible };
    }
  }
  return { rereads, calls };
}

/** One page or photo: read, then on photos segmented (when `sam`) and re-read. */
export async function readPage(
  kind: SourceKind,
  p: PageInput,
  opts: Opts & { sam?: boolean } = {},
): Promise<{ page: PageReading; calls: CallResult[] }> {
  const { sam = true, ...callOpts } = opts;
  const { extraction, calls } = await extractPage(kind, p, callOpts);
  const page: PageReading = { page: p.page, text: p.text, extraction, rereads: {} };
  if (p.text === null && p.image) {
    if (sam && SEGMENTED_KINDS.includes(kind)) {
      const s = await segmentPage(p.image, p.mime ?? "image/png", callOpts);
      calls.push(...s.calls);
      page.objects = s.objects;
    }
    const r = await rereadPage(p.image, extraction, callOpts, page.objects);
    page.rereads = r.rereads;
    calls.push(...r.calls);
  }
  return { page, calls };
}

export async function readSource(
  source: SourceMeta,
  pages: PageInput[],
  opts: Opts & { sam?: boolean } = {},
): Promise<{ reading: SourceReading; calls: CallResult[] }> {
  const calls: CallResult[] = [];
  const out: PageReading[] = [];
  for (const p of pages) {
    const r = await readPage(source.kind, p, opts);
    calls.push(...r.calls);
    out.push(r.page);
  }
  return { reading: { source, pages: out }, calls };
}
