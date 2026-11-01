import { z } from "zod";

// What Tomorrow sends Lens when a planned session passes undone, and what Lens
// sends back: POST /api/rebuild (docs/REBUILD_CONTRACT.md is the human-readable
// version of this file; the two change together). Tomorrow owns the plan and its
// availability; Lens decides what moves or drops and why, checks every move
// against the windows Tomorrow sent, and writes the one recovery message.

const Instant = z.iso.datetime({ offset: true });
const Zone = z
  .string()
  .refine((z) => Intl.supportedValuesOf("timeZone").includes(z) || z === "UTC", "unknown time zone");
const Id = z.string().min(1).max(64);

export const RebuildPlanned = z.object({
  id: Id,
  title: z.string().min(1).max(200),
  course: z.string().max(40).nullable(),
  start: Instant,
  end: Instant,
  /** Must be finished by this instant, when there is one. */
  due: Instant.nullable(),
  /** The deadline or exam this prepares for (an id in `deadlines`), if any. */
  for: Id.nullable(),
  /** The shortest version worth doing, in minutes. Lens never shortens below it; null means 30 (or the full length if shorter). */
  min_minutes: z.int().positive().max(600).nullable(),
  status: z.enum(["planned", "missed"]),
});

export const RebuildRequest = z
  .object({
    version: z.literal(1),
    zone: Zone,
    now: Instant,
    missed: z.object({
      item_id: Id,
      /** The person's reply to the check-in, in their words; null when they didn't reply. */
      reply: z.string().max(280).nullable(),
    }),
    /** Sessions and tasks Tomorrow placed, from now through the horizon, plus the missed one. Lens may move or drop these. */
    items: z.array(RebuildPlanned).min(1).max(100),
    /** Busy time Lens never moves or overlaps: classes, events, exams. */
    fixed: z.array(z.object({ title: z.string().min(1).max(200), start: Instant, end: Instant })).max(300),
    deadlines: z
      .array(
        z.object({ id: Id, title: z.string().min(1).max(200), course: z.string().max(40).nullable(), due: Instant }),
      )
      .max(100),
    /**
     * Free time Tomorrow would place a session in (awake hours, its buffers and
     * quiet hours already applied), not counting the time the items above use.
     */
    open_windows: z.array(z.object({ start: Instant, end: Instant })).max(200),
  })
  .superRefine((r, ctx) => {
    const missed = r.items.find((i) => i.id === r.missed.item_id);
    if (!missed) ctx.addIssue({ code: "custom", path: ["missed", "item_id"], message: "not one of items" });
    const ids = new Set<string>();
    for (const [n, i] of r.items.entries()) {
      if (ids.has(i.id)) ctx.addIssue({ code: "custom", path: ["items", n, "id"], message: "duplicate id" });
      ids.add(i.id);
      if (Date.parse(i.end) <= Date.parse(i.start))
        ctx.addIssue({ code: "custom", path: ["items", n, "end"], message: "must be after start" });
      if (i.for && !r.deadlines.some((d) => d.id === i.for))
        ctx.addIssue({ code: "custom", path: ["items", n, "for"], message: "not one of deadlines" });
    }
  });

export type RebuildRequest = z.infer<typeof RebuildRequest>;
export type RebuildPlanned = z.infer<typeof RebuildPlanned>;

export const DiffEntry = z.object({
  item_id: Id,
  action: z.enum(["move", "drop", "keep"]),
  /** The new time, for a move. */
  start: Instant.nullable(),
  end: Instant.nullable(),
  /** Why, for a move or drop: a clause that completes "because …". */
  reason: z.string().max(160).nullable(),
});

export const RebuildResponse = z.object({
  version: z.literal(1),
  /** One entry per item in the request, in the same order. */
  diff: z.array(DiffEntry),
  /** The one recovery message, ready to send as is. */
  message: z.string().min(1).max(600),
  /** "fallback" when the model couldn't be used and code placed the missed item in the first open time. */
  decided_by: z.enum(["agent", "fallback"]),
});

export type DiffEntry = z.infer<typeof DiffEntry>;
export type RebuildResponse = z.infer<typeof RebuildResponse>;
