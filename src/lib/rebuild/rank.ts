import type { Draft } from "@/lib/rebuild/draft";

// Where a session should go, ranked by code: the placement rules the agent is
// given and the evals hold it to. Every candidate already obeys the hard rules
// (src/lib/rebuild/rules.ts); this only orders them. Each stretch of free time
// is one candidate, at its best start. The score is a cost in hours, lowest
// first:
//
//   +10 for each day later it starts      sooner leaves time before the deadline, and spaces practice out
//   +3  for each hour already planned that day (classes and other sessions)     a lighter day beats a heavy one
//   +8  outside their study time (mornings 6-12, afternoons 12-17, nights 17-24), when they have one
//   +4  starting at 9 PM or later, unless they study at night
//   +5  ending within 2 hours of its deadline: no cramming right before it
//   +100, plus 0.5 a minute cut, when it has to be shortened to fit
//
// So a light day two days out (1 hour planned: 3 + 20) beats a heavy day tomorrow (6 hours: 18 + 10), and an
// evening tomorrow beats next week. Ties go to the earlier start.

export const WEIGHTS = { perDay: 10, perLoadHour: 3, offStudyTime: 8, lateStart: 4, nearDeadline: 5, shortened: 100, perMinuteCut: 0.5 } as const; // prettier-ignore
export const STUDY_HOURS = { mornings: [6, 12], afternoons: [12, 17], nights: [17, 24] } as const;
export const LATE_HOUR = 21;
const NEAR_DEADLINE_MIN = 120;

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
type Span = { s: number; e: number };

export type Ranked = {
  /** The stretch of free time. */
  s: number;
  e: number;
  /** Where in it the session goes, and how long it is there. */
  start: number;
  minutes: number;
  score: number;
  why: string[];
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

/** Hours already taken on the local day of `ms`: busy time and every other item where it now sits. */
export function loadHours(d: Draft, ms: number, except: string): number {
  const day = d.local(ms).startOf("day");
  const span = { s: day.toMillis(), e: day.plus({ days: 1 }).toMillis() };
  const taken = [
    ...d.req.fixed.map((f) => ({ s: Date.parse(f.start), e: Date.parse(f.end) })),
    ...d.req.items.filter((i) => i.id !== except).flatMap((i) => d.placement(i) ?? []),
  ];
  const mins = taken.reduce((a, x) => a + Math.max(0, Math.min(x.e, span.e) - Math.max(x.s, span.s)), 0) / MIN;
  return Math.round(mins / 6) / 10;
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
  opts: { minutes?: number; after?: number; before?: number; exclude?: Span[]; free?: Span[] } = {},
): Ranked[] {
  const item = d.item(itemId);
  if (!item) return [];
  const due = d.dueBy(item);
  const full = opts.minutes ?? d.length(item);
  const shortest = opts.minutes ?? d.shortest(item);
  const lo = Math.max(opts.after ?? d.now, d.now);
  const hi = Math.min(opts.before ?? Infinity, due ?? Infinity);
  const spans = minus(
    (opts.free ?? d.free(itemId)).map((x) => ({ s: Math.max(x.s, lo), e: Math.min(x.e, hi) })),
    opts.exclude ?? [],
  ).filter((x) => x.e - x.s >= 5 * MIN);
  const fits = spans.some((x) => x.e - x.s >= full * MIN);
  const study = d.req.prefs?.study_time ?? null;

  const score = (start: number, minutes: number) => {
    const t = d.local(start);
    const why: string[] = [];
    let cost = ((start - d.now) / DAY) * WEIGHTS.perDay;
    const load = loadHours(d, start, itemId);
    cost += load * WEIGHTS.perLoadHour;
    why.push(`${load}h already planned that day`);
    if (study) {
      const [a, b] = STUDY_HOURS[study];
      const inside = t.hour >= a && t.hour < b;
      if (!inside) cost += WEIGHTS.offStudyTime;
      why.push(inside ? `in their ${study}` : `outside their ${study}`);
    }
    if (t.hour >= LATE_HOUR && study !== "nights") {
      cost += WEIGHTS.lateStart;
      why.push("late in the evening");
    }
    if (due !== null && due - (start + minutes * MIN) < NEAR_DEADLINE_MIN * MIN) {
      cost += WEIGHTS.nearDeadline;
      why.push("right before the deadline");
    }
    if (minutes < full) {
      cost += WEIGHTS.shortened + (full - minutes) * WEIGHTS.perMinuteCut;
      why.push(`${minutes} of ${full} min`);
    }
    return { cost: Math.round(cost * 100) / 100, why };
  };

  const out: Ranked[] = [];
  for (const x of spans) {
    const room = Math.floor((x.e - x.s) / (5 * MIN)) * 5;
    const minutes = Math.min(full, room);
    // When the full length fits somewhere, only stretches that hold it count; otherwise the longest version down to
    // the shortest.
    if (minutes < (fits ? full : shortest)) continue;
    // Candidate starts: the earliest, and the first one inside their study time, if that's later in this stretch.
    const starts = [x.s];
    if (study) {
      const [a] = STUDY_HOURS[study];
      for (let day = d.local(x.s).startOf("day"); day.toMillis() < x.e; day = day.plus({ days: 1 })) {
        const s = Math.max(x.s, day.set({ hour: a }).toMillis());
        if (s > x.s && s + minutes * MIN <= x.e) starts.push(s);
      }
    }
    const best = starts
      .map((start) => ({ start, ...score(start, minutes) }))
      .sort((p, q) => p.cost - q.cost || p.start - q.start)[0];
    out.push({ s: x.s, e: x.e, start: best.start, minutes, score: best.cost, why: best.why });
  }
  return out.sort((p, q) => p.score - q.score || p.start - q.start);
}
