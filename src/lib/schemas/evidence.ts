import { z } from "zod";

// Evidence ties every extracted thing to where it was read. The model reports a
// quote and a box on its 0-1000 grid for one image; code adds which source and
// page that image was, and converts the box to 0-1 for drawing highlights.

/** A box as Muse Spark reports it: integers on a 0-1000 grid, origin top-left. */
export const ModelBox = z.object({
  x_min: z.int().min(0).max(1000),
  y_min: z.int().min(0).max(1000),
  x_max: z.int().min(0).max(1000),
  y_max: z.int().min(0).max(1000),
});
export type ModelBox = z.infer<typeof ModelBox>;

/** What the model returns for one extracted thing. */
export const ModelEvidence = z.object({
  quote: z.string().min(1).describe("The exact text as it appears in the source, copied character for character"),
  box: ModelBox.nullable().describe("Where the quote is in the image; null for pasted text"),
});
export type ModelEvidence = z.infer<typeof ModelEvidence>;

export const SourceKind = z.enum([
  "testudo_screenshot",
  "testudo_text",
  "syllabus_pdf",
  "whiteboard_photo",
  "notes_photo",
]);
export type SourceKind = z.infer<typeof SourceKind>;

/** A box normalized to 0-1 of the image it was read from. */
export const BBox = z
  .object({
    x0: z.number().min(0).max(1),
    y0: z.number().min(0).max(1),
    x1: z.number().min(0).max(1),
    y1: z.number().min(0).max(1),
  })
  .refine((b) => b.x1 > b.x0 && b.y1 > b.y0, "box must have positive area");
export type BBox = z.infer<typeof BBox>;

export const ObjectLabel = z.enum(["sticky_note", "paper", "whiteboard"]);
export type ObjectLabel = z.infer<typeof ObjectLabel>;

/** The SAM object a quote sits in (a sticky note, a sheet, the board). Its outline is the evidence highlight. */
export const Region = z.object({
  object_id: z.string().min(1),
  label: ObjectLabel,
  /** Convex outline in 0-1 coordinates of the image. */
  outline: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(3),
});
export type Region = z.infer<typeof Region>;

export const Evidence = z.object({
  source_id: z.string().min(1),
  /** 1-based page for PDFs; null for images and pasted text. */
  page: z.int().positive().nullable(),
  bbox: BBox.nullable(),
  quote: z.string().min(1),
  /** Photos segmented with SAM only; null when the quote is in no object, or SAM wasn't run. */
  region: Region.nullable().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const FieldStatus = z.enum(["verified", "needs_question", "unverified"]);
export type FieldStatus = z.infer<typeof FieldStatus>;

/** Converts a model box to 0-1, or null if it's degenerate (zero area or inverted). */
export function normalizeBox(box: ModelBox): BBox | null {
  const b = { x0: box.x_min / 1000, y0: box.y_min / 1000, x1: box.x_max / 1000, y1: box.y_max / 1000 };
  return BBox.safeParse(b).success ? b : null;
}

export function toEvidence(model: ModelEvidence, sourceId: string, page: number | null): Evidence {
  return { source_id: sourceId, page, bbox: model.box ? normalizeBox(model.box) : null, quote: model.quote };
}
