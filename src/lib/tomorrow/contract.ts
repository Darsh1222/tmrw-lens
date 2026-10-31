import { z } from "zod";
import { auditPlan } from "@/lib/plan/audit";
import { explainDate } from "@/lib/plan/explain";
import type { ClassBlock, Plan, PlanItem, SourceMeta } from "@/lib/plan/types";
import type { Evidence } from "@/lib/schemas/evidence";
import { toInstant } from "@/lib/resolve/dates";

// What Send delivers to Tomorrow: POST /api/lens/import (docs/IMPORT_CONTRACT.md
// is the human-readable version of this file; the two change together). Only
// verified items go, never one the person hasn't confirmed, and only after the
// date audit passes. Times are never invented: a deadline with no written time
// goes as a date with time null, and Tomorrow decides what that means.

const IsoDate = z.iso.date();
const HhMm = z.string().regex(/^\d{2}:\d{2}$/);
const Instant = z.iso.datetime({ offset: true });

export const EvidenceRef = z.object({
  /** "MATH141 syllabus", "whiteboard photo". */
  source: z.string().min(1).max(120),
  page: z.int().positive().nullable(),
  /** The exact words it was read from, or what the person typed. */
  quote: z.string().min(1).max(500),
  /** One line on how the date was computed, e.g. "Week 7 Thu, with classes starting Mon Aug 31". */
  computed_from: z.string().max(300).nullable(),
});

const Common = {
  /** Stable across sends of the same readings: Tomorrow skips one it already has. */
  lens_id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  course: z.string().max(20).nullable(),
  evidence: z.array(EvidenceRef).min(1).max(5),
};

export const ImportClass = z.object({
  ...Common,
  kind: z.literal("class_block"),
  meeting_type: z.enum(["lecture", "discussion", "lab", "other"]),
  location: z.string().max(120).nullable(),
  /** The first meeting. */
  start: Instant,
  end: Instant,
  /** RFC 5545 RRULE, with UNTIL in UTC when the last day of classes is known. */
  rrule: z.string().startsWith("FREQ=WEEKLY;"),
  /** Meetings that don't happen (breaks), as the start instant of each. */
  exdates: z.array(Instant),
});

export const ImportItem = z.object({
  ...Common,
  kind: z.enum(["deadline", "exam", "task"]),
  /** The day in the person's zone; null only for a task with no date. */
  date: IsoDate.nullable(),
  /** Wall-clock times in the person's zone; null when none is written. */
  start_time: HhMm.nullable(),
  end_time: HhMm.nullable(),
  /** The same as instants, when there's a time. */
  start: Instant.nullable(),
  end: Instant.nullable(),
});

export const ImportRequest = z.object({
  version: z.literal(1),
  /** IANA zone the dates and times are in. */
  zone: z.string().min(1),
  items: z
    .array(z.discriminatedUnion("kind", [ImportClass, ImportItem]))
    .min(1)
    .max(300),
});
export type ImportRequest = z.infer<typeof ImportRequest>;

export const ImportResponse = z.object({
  /** lens_id to Tomorrow's id, for everything created. */
  created: z.record(z.string(), z.string()),
  /** lens_ids Tomorrow already had (an earlier send), left as they are. */
  skipped_duplicates: z.array(z.string()),
});
export type ImportResponse = z.infer<typeof ImportResponse>;

const MEETING = { lecture: "lecture", discussion: "discussion", lab: "lab", other: "class" };

function refs(plan: Plan, sources: SourceMeta[], evidence: Evidence[], computed: string | null) {
  const label = (id: string) =>
    id === "answer" ? "your answer" : (sources.find((s) => s.id === id)?.label ?? "a source");
  return evidence.slice(0, 5).map((e) => ({
    source: label(e.source_id),
    page: e.page,
    quote: e.quote.slice(0, 500),
    computed_from: computed?.slice(0, 300) ?? null,
  }));
}

/** What can be sent now: verified, not left out. Everything else waits for an answer or an edit. */
export function sendable(plan: Plan): { classes: ClassBlock[]; items: PlanItem[]; waiting: number } {
  const skip = new Set(plan.skipped ?? []);
  const classes = plan.classes.filter((c) => c.status === "verified" && c.first_date && !skip.has(c.id));
  const items = plan.items.filter((i) => i.status === "verified" && (i.date || i.kind === "task") && !skip.has(i.id));
  const waiting =
    plan.classes.filter((c) => !skip.has(c.id)).length +
    plan.items.filter((i) => !skip.has(i.id)).length -
    classes.length -
    items.length;
  return { classes, items, waiting };
}

export class NotSendable extends Error {}

export function toImport(plan: Plan, sources: SourceMeta[]): ImportRequest {
  const audit = auditPlan(plan, sources);
  if (audit.invented.length) throw new NotSendable(`${audit.invented.length} date(s) don't trace to their source`);
  const { classes, items } = sendable(plan);
  const z_ = plan.zone;
  const out: ImportRequest["items"] = [
    ...classes.map((c) => ({
      lens_id: c.id,
      kind: "class_block" as const,
      title: `${c.course} ${MEETING[c.meeting_type]}`,
      course: c.course,
      meeting_type: c.meeting_type,
      location: c.location,
      start: toInstant(c.first_date!.value, c.start, z_),
      end: toInstant(c.first_date!.value, c.end, z_),
      rrule: c.rrule,
      exdates: c.skip_dates.map((s) => toInstant(s.date, c.start, z_)),
      evidence: refs(plan, sources, [c.evidence], c.first_date ? explainDate(c.first_date, plan) : null),
    })),
    ...items.map((i) => ({
      lens_id: i.id,
      kind: i.kind,
      title: i.title,
      course: i.course,
      date: i.date?.value ?? null,
      start_time: i.time?.start ?? null,
      end_time: i.time?.end ?? null,
      start: i.date && i.time ? toInstant(i.date.value, i.time.start, z_) : null,
      end: i.date && i.time?.end ? toInstant(i.date.value, i.time.end, z_) : null,
      evidence: refs(plan, sources, i.evidence, i.date ? explainDate(i.date, plan) : null),
    })),
  ];
  return ImportRequest.parse({ version: 1, zone: z_, items: out });
}
