import { DateTime } from "luxon";
import { z } from "zod";
import { KIND_LABEL } from "@/lib/extract/kinds";
import type { Answer } from "@/lib/plan/answer";
import { auditPlan } from "@/lib/plan/audit";
import { familyOf, normalizeCode } from "@/lib/plan/courses";
import { formatTime } from "@/lib/plan/merge";
import { planFrom } from "@/lib/plan/session";
import { norm } from "@/lib/plan/text";
import type { PlanItem, Question, SourceReading } from "@/lib/plan/types";
import { formatDate } from "@/lib/resolve/dates";
import { SourceKind } from "@/lib/schemas/evidence";
import { classImport, EvidenceRef, ImportClass, ImportItem, itemImport, sendable } from "@/lib/tomorrow/contract";

// Text-a-photo (docs/EXTRACT_CONTRACT.md): Tomorrow sends the photos someone
// texted, with the items it already has for them; Lens reads the photos, and
// says what's new, what changes an item Tomorrow already has, and what it needs
// to ask. Only verified new items are auto-applicable; a change to an existing
// item is applied only once the person answers its question. Everything here
// is code, run again after every answer: the model ran once, when the photos
// were read.

const IsoDate = z.iso.date();
const HhMm = z.string().regex(/^\d{2}:\d{2}$/);
const Instant = z.iso.datetime({ offset: true });
const Zone = z
  .string()
  .refine((v) => Intl.supportedValuesOf("timeZone").includes(v) || v === "UTC", "unknown time zone");

export const MAX_IMAGE_BYTES = 3_000_000;

export const ExistingItem = z.object({
  /** Tomorrow's id, echoed back in changes and duplicates. */
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  kind: z.enum(["deadline", "exam", "task"]).nullable(),
  course: z.string().max(40).nullable(),
  date: IsoDate.nullable(),
  time: HhMm.nullable(),
  /** Where Tomorrow got it, as the person would say it: "MATH141 syllabus", "a text from you". */
  source: z.string().min(1).max(120),
});
export type ExistingItem = z.infer<typeof ExistingItem>;

const Term = z.object({ start: IsoDate.nullable(), end: IsoDate.nullable() }).nullable();

export const ExtractRequest = z.object({
  version: z.literal(1),
  /** Tomorrow's opaque id for the person (not their phone or email): rate limits are per person. */
  user_ref: z.string().min(8).max(64),
  zone: Zone,
  /** When the text arrived. */
  now: Instant,
  /** JPEG or PNG, base64, at most 3 MB each. */
  images: z
    .array(z.object({ data: z.string().min(16).max(4_100_000) }))
    .min(1)
    .max(4),
  /** The person's items that could be on the photo: upcoming deadlines and exams, at most 300. */
  existing: z.array(ExistingItem).max(300),
  /** The term's first and last day of classes, when Tomorrow knows them ("Week 7 Thu" needs the first). */
  term: Term,
});
export type ExtractRequest = z.infer<typeof ExtractRequest>;

export const AnswerIn = z.object({
  question_id: z.string().min(1).max(120),
  option_id: z.string().min(1).max(80),
  /** What the person typed, for a question that asks for a date, time, or text. */
  value: z.string().max(200).nullable(),
});

export const ExtractAnswerRequest = z.object({
  version: z.literal(1),
  /** The review token from the extract response (the last part of review.url). */
  review: z.string().min(20).max(200),
  answers: z.array(AnswerIn).min(1).max(50),
});

const Status = z.enum(["verified", "needs_question", "unverified", "conflict"]);
const Flags = {
  status: Status,
  /** True only for a verified item with a date (or a task): safe to create without asking. */
  auto_apply: z.boolean(),
};

export const ExtractResponse = z.object({
  version: z.literal(1),
  /** One SMS-ready line on what was found and what's next (at most 320 characters). */
  summary: z.string().max(320),
  photos: z.array(
    z.object({ index: z.int().min(0), kind: SourceKind.or(z.literal("other")), readable: z.enum(["clear", "partly", "no"]), items: z.int().min(0) }), // prettier-ignore
  ),
  /** New items and classes, not already in Tomorrow. */
  items: z.array(z.union([ImportItem.extend(Flags), ImportClass.extend(Flags)])),
  /** Existing items the photo says something different about. Never applied until answered. */
  changes: z.array(
    z.object({
      existing_id: z.string(),
      lens_id: z.string(),
      title: z.string(),
      /** "moved": the photo says so ("moved to Mon"). "contradiction": it just says something else. */
      kind: z.enum(["moved", "contradiction"]),
      from: z.object({ date: IsoDate.nullable(), time: HhMm.nullable() }),
      to: z.object({ date: IsoDate.nullable(), time: HhMm.nullable() }),
      evidence: EvidenceRef,
      question_id: z.string(),
      /** confirmed: the person picked the photo's version, apply it. kept: they kept Tomorrow's. */
      status: z.enum(["needs_question", "confirmed", "kept"]),
      auto_apply: z.boolean(),
    }),
  ),
  /** Read from the photo, and already in Tomorrow with the same date: nothing to do. */
  duplicates: z.array(z.object({ existing_id: z.string(), lens_id: z.string() })),
  /** One per ambiguity, in the order to ask them. */
  questions: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      options: z.array(z.object({ id: z.string(), label: z.string() })),
      /** The option that asks them to type something, and what: date "YYYY-MM-DD", time "HH:mm", or text. */
      input: z.enum(["date", "time", "course", "text", "dates", "fields"]).nullable(),
      /** Pre-selected, never applied until they answer. */
      suggested: z.string().nullable(),
      why: z.string().nullable(),
    }),
  ),
  review: z.object({ url: z.url(), expires_at: Instant }),
});
export type ExtractResponse = z.infer<typeof ExtractResponse>;

export type PhotoInfo = ExtractResponse["photos"][number];

/** What a review link holds: enough to rebuild the response after any answer, with no model call. */
export type ExtractState = {
  version: 1;
  zone: string;
  now: string;
  readings: SourceReading[];
  photos: PhotoInfo[];
  existing: ExistingItem[];
  term: z.infer<typeof Term>;
  answers: Answer[];
};

const CHANGE = /\b(moved|postponed|rescheduled|pushed( back)?|now (due|on)|changed|extended|instead)\b/i;
const label = (s: { date: string | null; time: string | null }) =>
  s.date ? `${formatDate(s.date)}${s.time ? `, ${formatTime(s.time)}` : ""}` : "no date";

/** Is this read item one Tomorrow already has? Same course and kind of thing, and the same one of it. */
function match(i: PlanItem, existing: ExistingItem[], from: string): ExistingItem | null {
  const options = existing.filter((e) => {
    const course = e.course ? normalizeCode(e.course) : null;
    if (!i.course || course !== i.course) return false;
    if (e.kind && e.kind !== i.kind) return false;
    const f = familyOf(e.title);
    if (f.family !== i.family) return false;
    if (i.family === null) return norm(e.title) === norm(i.title);
    if (i.number !== null && f.number !== null) return i.number === f.number;
    if (i.number === null && f.number === null) return !!i.date && e.date === i.date.value;
    // "quiz moved to Mon" against "Quiz 3": the same quiz if the photo says it moved, or the dates are within a week.
    if (i.evidence.some((ev) => CHANGE.test(ev.quote))) return true;
    return !!i.date && !!e.date && Math.abs(DateTime.fromISO(i.date.value).diff(DateTime.fromISO(e.date), "days").days) <= 7; // prettier-ignore
  });
  if (options.length <= 1) return options[0] ?? null;
  // Several unnumbered matches: the next one coming up from when the photo was taken.
  const dated = options.filter((e) => e.date).sort((a, b) => a.date!.localeCompare(b.date!));
  return dated.find((e) => e.date! >= from) ?? dated.at(-1) ?? options[0];
}

/** The plan the readings and answers give, with what Tomorrow knows about the term answered up front. */
export function planOf(state: ExtractState) {
  const today = DateTime.fromISO(state.now, { zone: state.zone }).toISODate()!;
  const planAnswers: Answer[] = [
    // What Tomorrow already knows answers the term questions before they're asked.
    ...(state.term?.start ? [{ question_id: "q_term_start", option_id: "edit", value: state.term.start }] : []),
    ...(state.term?.end ? [{ question_id: "q_term_end", option_id: "edit", value: state.term.end }] : []),
    ...state.answers
      .filter((a) => !/^q_(change|unreadable)_/.test(a.question_id))
      .map((a) => (a.option_id === "today" ? { ...a, option_id: "edit", value: today } : a)),
  ];
  return { today, ...planFrom(state.readings, { zone: state.zone, answers: planAnswers }) };
}

/** The response, from the state alone: the readings, what Tomorrow has, and the answers so far. */
export function assemble(state: ExtractState, review: ExtractResponse["review"]): ExtractResponse {
  const answered = new Map(state.answers.map((a) => [a.question_id, a]));
  const { today, plan, sources } = planOf(state);
  const invented = auditPlan(plan, sources).invented.length > 0;
  const ready = sendable(plan);
  const readyIds = new Set([...ready.items, ...ready.classes].map((x) => x.id));
  const skipped = new Set(plan.skipped ?? []);
  const auto = (id: string) => !invented && readyIds.has(id);

  const changes: ExtractResponse["changes"] = [];
  const duplicates: ExtractResponse["duplicates"] = [];
  const questions: ExtractResponse["questions"] = [];
  const fresh: PlanItem[] = [];
  for (const i of plan.items.filter((x) => !skipped.has(x.id))) {
    const from = i.date?.trace.inputs.photo_date ?? today;
    const e = match(i, state.existing, from);
    const qid = e ? `q_change_${e.id}` : "";
    if (!e || answered.get(qid)?.option_id === "different") {
      fresh.push(i);
      continue;
    }
    // Nothing to compare until the photo's own reading is settled: its question comes first.
    if (i.status !== "verified" || !i.date) continue;
    const to = { date: i.date.value, time: i.time?.start ?? null };
    const sameDate = to.date === e.date;
    // A time on one side only isn't a difference: date-only stays date-only.
    const sameTime = !to.time || !e.time || to.time === e.time;
    if (sameDate && sameTime) {
      duplicates.push({ existing_id: e.id, lens_id: i.id });
      continue;
    }
    const ev = { ...i.evidence[0], quote: i.evidence[0].quote.replace(/\s+/g, " ").trim() };
    const source = sources.find((s) => s.id === ev.source_id);
    const where = source ? KIND_LABEL[source.kind] : "photo";
    const moved = CHANGE.test(ev.quote);
    const a = answered.get(qid);
    const status = a?.option_id === "new" ? "confirmed" : a?.option_id === "keep" ? "kept" : "needs_question";
    changes.push({
      existing_id: e.id,
      lens_id: i.id,
      title: e.title,
      kind: moved ? "moved" : "contradiction",
      from: { date: e.date, time: e.time },
      to,
      evidence: { source: where, page: ev.page, quote: ev.quote.slice(0, 500), computed_from: null },
      question_id: qid,
      status,
      auto_apply: status === "confirmed",
    });
    if (status === "needs_question")
      questions.push({
        id: qid,
        text: `Your ${e.source} says ${e.title} is ${label(e)}. The ${where} says "${ev.quote}", which is ${label(to)}. Which is right?`, // prettier-ignore
        options: [
          { id: "new", label: `${label(to)} (the ${where})` },
          { id: "keep", label: `${label(e)} (your ${e.source})` },
          { id: "different", label: "They're two different things" },
        ],
        input: null,
        suggested: "new",
        why: moved ? `The ${where} says it changed, and it's newer than your ${e.source}.` : `The ${where} is newer than your ${e.source}.`, // prettier-ignore
      });
  }

  for (const q of plan.questions) questions.push(toSms(q, today));
  // The photo's own questions first: a change can only be asked once its reading is settled.
  questions.sort((a, b) => Number(a.id.startsWith("q_change_")) - Number(b.id.startsWith("q_change_")));
  for (const p of state.photos)
    if (p.readable === "no" && !answered.has(`q_unreadable_${p.index}`))
      questions.unshift({
        id: `q_unreadable_${p.index}`,
        text: `I couldn't read photo ${p.index + 1} well enough to trust any of it. Could you send a closer, sharper one?`,
        options: [
          { id: "resend", label: "I'll send another" },
          { id: "skip", label: "Skip it" },
        ],
        input: null,
        suggested: null,
        why: null,
      });

  const items: ExtractResponse["items"] = [
    ...plan.classes
      .filter((c) => c.first_date && !skipped.has(c.id))
      .map((c) => ({ ...classImport(plan, sources, c), status: c.status, auto_apply: auto(c.id) })),
    ...fresh.map((i) => ({ ...itemImport(plan, sources, i), status: i.status, auto_apply: auto(i.id) })),
  ];

  return {
    version: 1,
    summary: summarize(state.photos, items, changes, duplicates, questions),
    photos: state.photos.map((p) => ({
      ...p,
      items: plan.items.filter((i) => i.evidence.some((ev) => ev.source_id === `photo${p.index + 1}`)).length,
    })),
    items,
    changes,
    duplicates,
    questions,
    review,
  };
}

function toSms(q: Question, today: string): ExtractResponse["questions"][number] {
  const options = q.options.map((o) => ({ id: o.id, label: o.label }));
  // A texted photo was most likely taken the day it was sent: offered, pre-selected, never assumed.
  if (q.id.startsWith("q_photo_date_"))
    return {
      id: q.id,
      text: q.prompt,
      options: [
        { id: "today", label: `Today, ${formatDate(today)}` },
        { id: "edit", label: "Another day" },
      ],
      input: "date",
      suggested: "today",
      why: "Most photos are sent the day they're taken.",
    };
  return { id: q.id, text: q.prompt, options, input: q.input, suggested: q.suggested, why: q.why_suggested };
}

function summarize(
  photos: PhotoInfo[],
  items: ExtractResponse["items"],
  changes: ExtractResponse["changes"],
  duplicates: ExtractResponse["duplicates"],
  questions: ExtractResponse["questions"],
): string {
  if (photos.every((p) => p.readable === "no" || p.kind === "other"))
    return photos.some((p) => p.kind === "other" && p.readable !== "no")
      ? "That doesn't look like a schedule, syllabus, board, or notes, so I didn't add anything."
      : "I couldn't read that clearly enough to trust it, so I didn't add anything. A closer, sharper photo would help.";
  const ready = items.filter((i) => i.auto_apply);
  const name = (i: ExtractResponse["items"][number]) =>
    i.kind === "class_block" ? i.title : `${i.title} ${label({ date: i.date, time: i.start_time })}`;
  const parts = [
    ready.length ? `${ready.length} new: ${ready.slice(0, 3).map(name).join("; ")}${ready.length > 3 ? `; and ${ready.length - 3} more` : ""}` : "nothing new to add yet", // prettier-ignore
    ...changes
      .filter((c) => c.status === "needs_question")
      .slice(0, 2)
      .map((c) => `To check: ${c.title} ${label(c.from)} → ${label(c.to)}`),
    duplicates.length ? `${duplicates.length} already in your plan` : null,
    questions.length ? `${questions.length} question${questions.length === 1 ? "" : "s"} for you` : null,
  ].filter(Boolean);
  const text = `From your photo: ${parts.join(". ")}.`;
  return text.length <= 320 ? text : `${text.slice(0, 317)}…`;
}
