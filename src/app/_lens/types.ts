import type { PageReading, SourceMeta } from "@/lib/plan/types";
import type { SourceKind } from "@/lib/schemas/evidence";
import type { PreparedPage } from "./prepare";

/** One thing the person added: its prepared pages, and Muse Spark's reading of each once it's read. */
export type Input = {
  id: string;
  name: string;
  kind: SourceKind;
  label: string;
  /** When a photo was taken (EXIF), ISO with offset; null for documents and screenshots. */
  captured_at: string | null;
  added_at: string;
  pages: PreparedPage[];
  readings: (PageReading | null)[];
  status: "ready" | "reading" | "read" | "error";
  /** Pages read so far, for progress. */
  done: number;
  error: string | null;
  note: string | null;
  cost_usd: number;
  /** Replayed from a recording (the sample week), not read live. */
  recorded: boolean;
};

export const metaOf = (i: Input): SourceMeta => ({
  id: i.id,
  kind: i.kind,
  label: i.label,
  captured_at: i.captured_at,
  added_at: i.added_at,
});
