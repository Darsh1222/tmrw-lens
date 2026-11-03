import type { Draft } from "@/lib/rebuild/draft";

// Where a session should go, ranked by code: the placement rules the agent is
// given and the evals hold it to. Every candidate already obeys the hard rules
// (src/lib/rebuild/rules.ts); this only orders them. Each stretch of free time
// is one candidate, at its best start.
//
// How much "sooner" matters depends on urgency. Slack is the free time left
// before the deadline over the time the work needs.
//
//   Tight (due within 30 hours, or slack under 2): the soonest good slot wins.
//     +1   for each hour later it starts
//   Comfortable (or no deadline): quality wins; soonness only breaks ties.
//     +4   for each day later it starts
//     +2   for each hour already planned that day (classes and other sessions)  a lighter day
//     +3   for each other study session already that day                         spread across days
//     +8   outside their study time (mornings 6-12, afternoons 12-17, nights 17-24), when they have one
//     +15  ending within 24 hours of its deadline                                 a day's buffer
//     +8   the same day as the miss, or within 4 hours of it                      not right after the miss
//     +4   starting at 9 PM or later, unless they study at night
//   Either way:
//     -15  on the day they said they're free from (a reply offering time: "later today after 6")
//     +30  the morning of another exam or quiz, before it: only when nothing else fits
//     +100, plus 0.5 a minute cut, when it has to be shortened to fit
//
// Each candidate also carries the factors code checked true of it ("a lighter
// afternoon", "with a week to spare"): the reason is built from these, so it
// can't claim what isn't so.

export const WEIGHTS = {
  tight: { perHour: 1, lateStart: 1, offStudyTime: 1 },
  comfortable: { perDay: 4, perLoadHour: 2, perSession: 3, offStudyTime: 8, noBuffer: 15, afterMiss: 8, lateStart: 4 },
  offered: -15,
  examMorning: 30,
  shortened: 100,
  perMinuteCut: 0.5,
} as const;
export const STUDY_HOURS = { mornings: [6, 12], afternoons: [12, 17], nights: [17, 24] } as const;
export const LATE_HOUR = 21;
const TIGHT_HOURS = 30;
const TIGHT_SLACK = 2;
const BUFFER_HOURS = 24;
const AFTER_MISS_HOURS = 4;
export const EXAM = /\b(exam|quiz|midterm|final|test)\b/i;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
type Span = { s: number; e: number };

export type FactorKey =
  | "soonest"
  | "only"
  | "last"
  | "longest"
  | "lighter"
  | "free_part"
  | "fresh_morning"
  | "study_time"
  | "after_event"
  | "buffer";
export type Factor = { key: FactorKey; text: string };

export type Ranked = {
  /** The stretch of free time. */
  s: number;
  e: number;
  /** Where in it the session goes, and how long it is there. */
  start: number;
  minutes: number;
  score: number;
  why: string[];
  /** What code checked true of this slot, for the reason. */
  factors: Factor[];
};

function minus(spans: Span[], cut: Span[]): Span[] {
  let out = spans;
  for (const c of cut)
    out = out.flatMap((x) =>
      c.e <= x.s || c.s >= x.e
        ? [x]
        : [...(c.s > x.s ? [{ s: x.s, e: c.s }] : []), ...(c.e < x.e ? [{ s: c.e, e: x.e }] : [])],
    );
  return out;
}

const dayOf = (d: Draft, ms: number) => {
  const day = d.local(ms).startOf("day");
  return { s: day.toMillis(), e: day.plus({ days: 1 }).toMillis() };
};
const overlapMs = (a: Span, b: Span) => Math.max(0, Math.min(a.e, b.e) - Math.max(a.s, b.s));

/** Where everything else is: busy time, and every other item where it now sits. */
function taken(d: Draft, except: string) {
  return {
    fixed: d.req.fixed.map((f) => ({ s: Date.parse(f.start), e: Date.parse(f.end), title: f.title })),
    items: d.req.items.filter((i) => i.id !== except).flatMap((i) => d.placement(i) ?? []),
  };
}

/** Hours already taken on the local day of `ms`: busy time and every other item where it now sits. */
export function loadHours(d: Draft, ms: number, except: string): number {
  const day = dayOf(d, ms);
  const t = taken(d, except);
  const mins = [...t.fixed, ...t.items].reduce((a, x) => a + overlapMs(x, day), 0) / MIN;
  return Math.round(mins / 6) / 10;
}

const partOf = (hour: number) => (hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening");
const PART_HOURS = { morning: [0, 12], afternoon: [12, 17], evening: [17, 24] } as const;
const NUMBER = ["", "a", "two", "three", "four", "five", "six"];

/** Whether it's tight: due within 30 hours, or less than twice the work's worth of free time before the deadline. */
export function urgency(d: Draft, itemId: string, minutes: number, free: Span[]): "tight" | "comfortable" {
  const item = d.item(itemId);
  const due = item ? d.dueBy(item) : null;
  if (due === null) return "comfortable";
  if (due - d.now <= TIGHT_HOURS * HOUR) return "tight";
  const before = free.reduce((a, x) => a + Math.max(0, Math.min(x.e, due) - Math.max(x.s, d.now)), 0) / MIN;
  return before / minutes < TIGHT_SLACK ? "tight" : "comfortable";
}

/**
 * Free time for `itemId`, best first. `minutes` fixes the length (a partial session); otherwise its full length, or,
 * when nothing that long fits, the longest it can be down to its shortest version. `after`/`before` bound it (what a
 * reply rules out), `exclude` cuts spans out, and `free` replaces the Draft's free time (the evals use it to free the
 * time of items a case may move).
 */
export function rankSlots(
  d: Draft,
  itemId: string,
  /**
   * `at`: report only the stretch holding a session starting then, with its factors at that exact start. `offered`: a
   * time their reply offers ("later today after 6"), preferred.
   */
  opts: { minutes?: number; after?: number; before?: number; exclude?: Span[]; free?: Span[]; at?: number; offered?: Span } = {}, // prettier-ignore
): Ranked[] {
  const item = d.item(itemId);
  if (!item) return [];
  const due = d.dueBy(item);
  const deadline = d.deadline(item);
  const full = opts.minutes ?? d.length(item);
  const shortest = opts.minutes ?? d.shortest(item);
  const lo = Math.max(opts.after ?? d.now, d.now);
  const hi = Math.min(opts.before ?? Infinity, due ?? Infinity);
  const free = opts.free ?? d.free(itemId);
  const spans = minus(
    free.map((x) => ({ s: Math.max(x.s, lo), e: Math.min(x.e, hi) })),
    opts.exclude ?? [],
  ).filter((x) => x.e - x.s >= 5 * MIN);
  const fits = spans.some((x) => x.e - x.s >= full * MIN);
  const study = d.req.prefs?.study_time ?? null;
  const mode = urgency(d, itemId, full, spans);
  const missEnd = item.status === "missed" ? Date.parse(item.end) : null;
  const t = taken(d, itemId);
  const exams = d.req.deadlines.filter((x) => x.id !== item.for && EXAM.test(x.title)).map((x) => Date.parse(x.due));
  const sessionsOn = (ms: number) => t.items.filter((x) => overlapMs(x, dayOf(d, ms)) > 0).length;
  const examMorning = (s: number, e: number) =>
    exams.some((due) => d.local(due).hasSame(d.local(s), "day") && e <= due && d.local(due).hour < 17);

  const score = (start: number, minutes: number) => {
    const end = start + minutes * MIN;
    const h = d.local(start).hour;
    const why: string[] = [];
    let cost = 0;
    if (mode === "tight") {
      const w = WEIGHTS.tight;
      cost += ((start - d.now) / HOUR) * w.perHour;
      if (h >= LATE_HOUR && study !== "nights") cost += w.lateStart;
      if (study && (h < STUDY_HOURS[study][0] || h >= STUDY_HOURS[study][1])) cost += w.offStudyTime;
      why.push("tight: the soonest good time wins");
    } else {
      const w = WEIGHTS.comfortable;
      cost += ((start - d.now) / DAY) * w.perDay;
      const load = loadHours(d, start, itemId);
      cost += load * w.perLoadHour;
      why.push(`${load}h planned that day`);
      const n = sessionsOn(start);
      cost += n * w.perSession;
      if (n) why.push(`${n} other session${n > 1 ? "s" : ""} that day`);
      if (study) {
        const inside = h >= STUDY_HOURS[study][0] && h < STUDY_HOURS[study][1];
        if (!inside) cost += w.offStudyTime;
        why.push(inside ? `in their ${study}` : `outside their ${study}`);
      }
      if (due !== null && due - end < BUFFER_HOURS * HOUR) {
        cost += w.noBuffer;
        why.push("under a day before it's due");
      }
      if (
        missEnd !== null &&
        (start - missEnd < AFTER_MISS_HOURS * HOUR || d.local(start).hasSame(d.local(missEnd), "day"))
      ) {
        // prettier-ignore
        cost += w.afterMiss;
        why.push("right after the miss");
      }
      if (h >= LATE_HOUR && study !== "nights") {
        cost += w.lateStart;
        why.push("late in the evening");
      }
    }
    if (opts.offered && start >= opts.offered.s && start < opts.offered.e) {
      cost += WEIGHTS.offered;
      why.push("when they said they're free");
    }
    if (examMorning(start, end)) {
      cost += WEIGHTS.examMorning;
      why.push("the morning of another exam");
    }
    if (minutes < full) {
      cost += WEIGHTS.shortened + (full - minutes) * WEIGHTS.perMinuteCut;
      why.push(`${minutes} of ${full} min`);
    }
    return { cost: Math.round(cost * 100) / 100, why };
  };

  const out: Omit<Ranked, "factors">[] = [];
  for (const x of spans) {
    const room = Math.floor((x.e - x.s) / (5 * MIN)) * 5;
    const minutes = Math.min(full, room);
    if (minutes < (fits ? full : shortest)) continue;
    // Candidate starts: the earliest, the first inside their study time, and (when there's room) the first past the
    // 4 hours after the miss, if those are later in this stretch.
    const starts = new Set([x.s]);
    for (let day = d.local(x.s).startOf("day"); day.toMillis() < x.e; day = day.plus({ days: 1 }))
      if (study) starts.add(Math.max(x.s, day.set({ hour: STUDY_HOURS[study][0] }).toMillis()));
    if (mode === "comfortable" && missEnd !== null) starts.add(Math.max(x.s, missEnd + AFTER_MISS_HOURS * HOUR));
    if (opts.offered) starts.add(Math.max(x.s, opts.offered.s));
    const best = [...starts]
      .map((s) => Math.ceil(s / (5 * MIN)) * 5 * MIN)
      .filter((s) => s >= x.s && s + minutes * MIN <= x.e)
      .map((start) => ({ start, ...score(start, minutes) }))
      .sort((p, q) => p.cost - q.cost || p.start - q.start)[0];
    if (best) out.push({ s: x.s, e: x.e, start: best.start, minutes, score: best.cost, why: best.why });
  }
  out.sort((p, q) => p.score - q.score || p.start - q.start);

  // The factors code can stand behind, per candidate.
  const loads = new Map(out.map((x) => [d.local(x.start).toISODate(), loadHours(d, x.start, itemId)]));
  const minLoad = Math.min(...loads.values());
  const maxLoad = Math.max(...loads.values());
  const what = deadline ? deadline.title : "it's due";
  const withFactors = (x: Omit<Ranked, "factors">): Ranked => {
    const factors: Factor[] = [];
    const end = x.start + x.minutes * MIN;
    const h = d.local(x.start).hour;
    const part = partOf(h);
    const day = d.local(x.start).startOf("day");
    const [a, b] = PART_HOURS[part];
    const window = { s: day.plus({ hours: a }).toMillis(), e: day.plus({ hours: b }).toMillis() };
    if (mode === "tight" && due !== null) {
      // Against every stretch that would hold even its shortest version, so a shorter fit elsewhere isn't hidden.
      const any = spans.filter((y) => y.e - y.s >= Math.min(x.minutes, d.shortest(item)) * MIN).sort((p, q) => p.s - q.s); // prettier-ignore
      // "Only" when this stretch is the only one and holds just one session: a long free evening is many times.
      if (any.length === 1 && x.e - x.s < 2 * x.minutes * MIN)
        factors.push({ key: "only", text: `the only time it fits before ${what}` }); // prettier-ignore
      else if (any[0]?.s === x.s && x.start === x.s)
        factors.push({ key: "soonest", text: `the soonest it fits before ${what}` }); // prettier-ignore
      else if (any.at(-1)?.s === x.s) factors.push({ key: "last", text: `the last time it fits before ${what}` });
    }
    if (x.minutes < full && out.every((y) => y.e - y.s <= x.e - x.s))
      factors.push({ key: "longest", text: `the longest free stretch before ${what}` });
    const load = loads.get(day.toISODate()!)!;
    if (loads.size > 1 && load === minLoad && maxLoad > minLoad) factors.push({ key: "lighter", text: `a lighter ${part}` }); // prettier-ignore
    if (![...t.fixed, ...t.items].some((y) => overlapMs(y, window) > 0))
      factors.push({ key: "free_part", text: `your free ${part}` });
    if (part === "morning" && !exams.some((e) => d.local(e).hasSame(day, "day")))
      factors.push({ key: "fresh_morning", text: "a fresh morning, with no quiz that day" });
    if (study && h >= STUDY_HOURS[study][0] && h < STUDY_HOURS[study][1])
      factors.push({ key: "study_time", text: `in your ${study === "nights" ? "evening" : study.slice(0, -1)} study time` }); // prettier-ignore
    const before = t.fixed.find((f) => f.e <= x.start && x.start - f.e <= 30 * MIN);
    if (before) factors.push({ key: "after_event", text: `right after ${before.title}` });
    if (due !== null) {
      // Calendar days, as people count them: Saturday morning is two days before a Monday morning deadline.
      const days = Math.round(d.local(due).startOf("day").diff(d.local(end).startOf("day"), "days").days);
      if (days >= 7) factors.push({ key: "buffer", text: "with a week to spare" });
      else if (days >= 2) factors.push({ key: "buffer", text: `with ${NUMBER[days]} days to spare` });
      else if (days === 1) factors.push({ key: "buffer", text: "a day before it's due" });
    }
    return { ...x, factors };
  };
  if (opts.at === undefined) return out.map(withFactors);
  const at = opts.at;
  const c = out.find((x) => x.s <= at && at + x.minutes * MIN <= x.e);
  return c ? [withFactors({ ...c, start: at })] : [];
}

/** Which factors combine into a reason, strongest first: urgency, then quality, and the buffer last. */
export const FACTOR_ORDER: FactorKey[] = ["only", "last", "soonest", "longest", "lighter", "free_part", "study_time", "after_event", "fresh_morning", "buffer"]; // prettier-ignore

/** The reason's words, from factor texts (and a reply phrase): "a lighter afternoon with a week to spare". */
export function compose(texts: { key: string; text: string }[]): string {
  // One urgency claim is enough ("the only time it fits" already says it's the soonest).
  const urgent = texts.filter((t) => ["only", "last", "soonest"].includes(t.key));
  const kept = texts.filter((t) => !urgent.includes(t) || t === urgent[0]);
  const main = kept.filter((t) => t.key !== "buffer").map((t) => t.text);
  const buffer = kept.find((t) => t.key === "buffer")?.text;
  if (!main.length) return buffer ?? "";
  const head = main.join(", ");
  return buffer ? `${head}${buffer.startsWith("with") ? " " : ", "}${buffer}` : head;
}
