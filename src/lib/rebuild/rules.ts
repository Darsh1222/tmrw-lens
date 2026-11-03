import { DateTime } from "luxon";
import type { RebuildPlanned, RebuildRequest, RebuildResponse } from "@/lib/rebuild/contract";

// The rules no rebuild may break, in code, never the model's call. The Draft
// keeps every move inside them (so the agent and code's fallback can't break
// them); hardRuleViolations checks a finished rebuild against them again from
// scratch, independently of how it was made, including what its message says.
//
// 1. Nothing overlaps classes and other busy time, sleep, quiet hours, time outside study hours, or another item.
// 2. Every move is after now and finishes before it's due.
// 3. Nothing lands within 90 minutes of the missed session's end, unless its deadline is within 24 hours.
// 4. Nothing ends within an hour of bedtime.
// 5. The message's times are exactly the moves' times (and the offer's), and it says nothing else changed, truly.

export const MISS_GAP_MIN = 90;
export const SLEEP_BUFFER_MIN = 60;
export const URGENT_HOURS = 24;
/** Assumed when Tomorrow doesn't send the person's sleep: a student's. */
export const DEFAULT_SLEEP = { start: "00:30", end: "08:30" } as const;

/** Their sleep: as sent, or a student's default (a morning person up at 7, a night person to bed at 1:30). */
export function sleepOf(req: RebuildRequest): { start: string; end: string } {
  if (req.prefs?.sleep) return req.prefs.sleep;
  const t = req.prefs?.study_time;
  return t === "mornings" ? { start: "23:00", end: "07:00" } : t === "nights" ? { start: "01:30", end: "09:30" } : DEFAULT_SLEEP; // prettier-ignore
}

/** Study hours when Tomorrow doesn't send them: 9am to 11pm; from 7:30am for a morning person, to 12:30am for a night one. */
export function studyHours(req: RebuildRequest): { start: string; end: string } {
  if (req.prefs?.study_hours) return req.prefs.study_hours;
  const t = req.prefs?.study_time;
  return { start: t === "mornings" ? "07:30" : "09:00", end: t === "nights" ? "00:30" : "23:00" };
}

const MIN = 60_000;
export type Span = { s: number; e: number };

const clock = (hhmm: string) => hhmm.split(":").map(Number) as [number, number];
const overlaps = (a: Span, b: Span) => a.s < b.e && b.s < a.e;

/** The latest an item can finish: its own due time or its deadline's, whichever is sooner. */
export function dueOf(req: RebuildRequest, i: RebuildPlanned): number | null {
  const d = i.for ? req.deadlines.find((x) => x.id === i.for) : undefined;
  const times = [i.due, d?.due].filter((x): x is string => !!x).map(Date.parse);
  return times.length ? Math.min(...times) : null;
}

export const missedOf = (req: RebuildRequest) => req.items.find((i) => i.id === req.missed.item_id)!;

/** Each night between `from` and `to`: bedtime and waking, in the person's zone (daylight saving included). */
export function nights(req: RebuildRequest, from: number, to: number): { bed: number; wake: number }[] {
  const sleep = sleepOf(req);
  const [bh, bm] = clock(sleep.start);
  const [wh, wm] = clock(sleep.end);
  const out: { bed: number; wake: number }[] = [];
  const last = DateTime.fromMillis(to, { zone: req.zone }).startOf("day").plus({ days: 1 });
  for (
    let day = DateTime.fromMillis(from, { zone: req.zone }).startOf("day").minus({ days: 1 });
    day <= last;
    day = day.plus({ days: 1 })
  ) {
    // prettier-ignore
    // A bedtime before noon ("00:30") is that night, after midnight.
    const bed = (bh < 12 ? day.plus({ days: 1 }) : day).set({ hour: bh, minute: bm });
    let wake = bed.startOf("day").set({ hour: wh, minute: wm });
    if (wake <= bed) wake = wake.plus({ days: 1 }).set({ hour: wh, minute: wm });
    out.push({ bed: bed.toMillis(), wake: wake.toMillis() });
  }
  return out;
}

/**
 * Time nothing may be placed in: each night from an hour before bedtime until waking, the daily quiet hours, and the
 * time outside study hours (from the latest end to the earliest start).
 */
export function blocked(req: RebuildRequest, from: number, to: number, opts: { studyHours?: boolean } = {}): Span[] {
  const out: Span[] = nights(req, from, to).map((n) => ({ s: n.bed - SLEEP_BUFFER_MIN * MIN, e: n.wake }));
  const last = DateTime.fromMillis(to, { zone: req.zone }).startOf("day").plus({ days: 1 });
  const study = studyHours(req);
  // An offer (applied only if they say yes) may use any awake time; what Lens places itself stays in study hours.
  const off = opts.studyHours === false ? [] : [{ start: study.end, end: study.start }];
  for (const q of [...(req.prefs?.quiet ?? []), ...off]) {
    const [sh, sm] = clock(q.start);
    const [eh, em] = clock(q.end);
    for (
      let day = DateTime.fromMillis(from, { zone: req.zone }).startOf("day").minus({ days: 1 });
      day <= last;
      day = day.plus({ days: 1 })
    ) {
      // prettier-ignore
      const s = day.set({ hour: sh, minute: sm });
      let e = day.set({ hour: eh, minute: em });
      if (e <= s) e = day.plus({ days: 1 }).set({ hour: eh, minute: em });
      out.push({ s: s.toMillis(), e: e.toMillis() });
    }
  }
  return out;
}

/** The 90 minutes after the missed session (and the session itself), unless its deadline is within 24 hours. */
export function missGap(req: RebuildRequest): Span | null {
  const m = missedOf(req);
  const due = dueOf(req, m);
  if (due !== null && due - Date.parse(req.now) <= URGENT_HOURS * 60 * MIN) return null;
  return { s: Date.parse(m.start), e: Date.parse(m.end) + MISS_GAP_MIN * MIN };
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Every time the message names, as instants, read back from its words alone: "7pm today", "9:30am tomorrow",
 * "Thu 4pm", "Thu Nov 12, 4pm", and grouped times sharing one day ("to 2pm and ... to 3pm tomorrow"). A string is a
 * time it couldn't place.
 */
export function messageTimes(req: RebuildRequest, message: string): number[] | string {
  const now = DateTime.fromMillis(Date.parse(req.now), { zone: req.zone });
  const out: number[] = [];
  for (const m of message.matchAll(/\b(\d{1,2})(?::(\d{2}))?(am|pm)\b/g)) {
    const end = m.index! + m[0].length;
    let hour = Number(m[1]) % 12;
    if (m[3] === "pm") hour += 12;
    const minute = Number(m[2] ?? 0);
    const before = message.slice(Math.max(0, m.index! - 16), m.index!);
    const named = before.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?: (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}),)? $/); // prettier-ignore
    const shared = message.slice(end).match(/^[^]*?\b(today|tomorrow)\b/);
    let day: DateTime | null = null;
    if (named?.[2]) {
      day = now.set({ month: MONTHS.indexOf(named[2]) + 1, day: Number(named[3]) }).startOf("day");
      if (day < now.startOf("day")) day = day.plus({ years: 1 });
    } else if (named) {
      const want = DAYS.indexOf(named[1]) + 1;
      for (let k = 1; k <= 7 && !day; k++) if (now.plus({ days: k }).weekday === want) day = now.plus({ days: k }).startOf("day"); // prettier-ignore
    } else if (shared) {
      day = now.startOf("day").plus({ days: shared[1] === "tomorrow" ? 1 : 0 });
    }
    if (!day) return `"${m[0]}" has no day`;
    out.push(day.set({ hour, minute }).toMillis());
  }
  return out;
}

/** Where every item ends up after the rebuild: its new time, its old one, or nowhere (dropped, or missed and kept). */
function finalPlacements(req: RebuildRequest, res: RebuildResponse): Map<string, Span | null> {
  const by = new Map(res.diff.map((x) => [x.item_id, x]));
  return new Map(
    req.items.map((i) => {
      const x = by.get(i.id);
      if (x?.action === "move" && x.start && x.end) return [i.id, { s: Date.parse(x.start), e: Date.parse(x.end) }];
      if (x?.action === "drop") return [i.id, null];
      return [i.id, i.status === "missed" ? null : { s: Date.parse(i.start), e: Date.parse(i.end) }];
    }),
  );
}

/** Every hard rule a finished rebuild breaks; empty when it breaks none. */
export function hardRuleViolations(req: RebuildRequest, res: RebuildResponse): string[] {
  const out: string[] = [];
  const now = Date.parse(req.now);
  const where = finalPlacements(req, res);
  const moves = res.diff.filter((x) => x.action === "move" && x.start && x.end);
  const horizon = Math.max(now, ...moves.map((x) => Date.parse(x.end!)), ...(res.offer ? [Date.parse(res.offer.end)] : [])); // prettier-ignore
  const off = blocked(req, now, horizon);
  const awakeOff = blocked(req, now, horizon, { studyHours: false });
  const gap = missGap(req);
  const fixed = req.fixed.map((f) => ({ what: f.title, s: Date.parse(f.start), e: Date.parse(f.end) }));
  const check = (id: string, x: Span, missed: boolean, rules = off) => {
    const i = req.items.find((y) => y.id === id)!;
    const due = dueOf(req, i);
    if (x.s < now) out.push(`${id}: starts in the past`);
    if (due !== null && x.e > due) out.push(`${id}: finishes after it's due`);
    for (const f of fixed) if (overlaps(x, f)) out.push(`${id}: overlaps ${f.what}`);
    for (const [other, y] of where) if (other !== id && y && overlaps(x, y)) out.push(`${id}: overlaps ${other}`);
    for (const b of rules) if (overlaps(x, b)) out.push(`${id}: in sleep, the hour before bed, quiet hours, or outside study hours`); // prettier-ignore
    if (missed && gap && overlaps(x, gap)) out.push(`${id}: within ${MISS_GAP_MIN} min of the missed session`);
  };
  for (const x of moves) check(x.item_id, { s: Date.parse(x.start!), e: Date.parse(x.end!) }, x.item_id === req.missed.item_id); // prettier-ignore
  if (res.offer) check(res.offer.item_id, { s: Date.parse(res.offer.start), e: Date.parse(res.offer.end) }, false, awakeOff); // prettier-ignore

  // The message, read on its own: its times are the moves' (and the offer's), and only changed items are named.
  const said = messageTimes(req, res.message);
  const want = [...moves.map((x) => Date.parse(x.start!)), ...(res.offer ? [Date.parse(res.offer.start)] : [])];
  if (typeof said === "string") out.push(`message: ${said}`);
  else if (JSON.stringify([...said].sort()) !== JSON.stringify([...want].sort()))
    out.push("message: its times aren't exactly the moves' times");
  if (!res.message.endsWith("Nothing else changed.")) out.push(`message: doesn't end "Nothing else changed."`);
  const titles = new Map(req.items.map((i) => [i.id, i.title]));
  const changed = res.diff.filter((x) => x.action !== "keep").map((x) => titles.get(x.item_id)!);
  // The missed item is what the check-in asked about, so "No free time before the quiz" is about it; any other change
  // has to be named.
  for (const x of res.diff)
    if (x.action !== "keep" && x.item_id !== req.missed.item_id && !res.message.includes(titles.get(x.item_id)!))
      out.push(`message: doesn't name "${titles.get(x.item_id)}", which changed`);
  const mentioned = [...changed, ...req.deadlines.map((d) => d.title)];
  for (const x of res.diff)
    if (x.action === "keep") {
      const t = titles.get(x.item_id)!;
      if (res.message.includes(t) && !mentioned.some((m) => m !== t && m.includes(t)))
        out.push(`message: names "${t}", which didn't change`);
    }
  return out;
}
