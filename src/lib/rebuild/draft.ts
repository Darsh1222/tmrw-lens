import { DateTime } from "luxon";
import { compose, FACTOR_ORDER, rankSlots, type Factor } from "@/lib/rebuild/rank";
import type { DiffEntry, RebuildPlanned, RebuildRequest, RebuildResponse } from "@/lib/rebuild/contract";
import {
  blocked,
  hardRuleViolations,
  MISS_GAP_MIN,
  missGap,
  nights,
  SLEEP_BUFFER_MIN,
  type Span as RuleSpan,
} from "@/lib/rebuild/rules";

// The rebuild's working copy of the plan. Code owns every fact here: what's
// free, whether a move fits, the times in the message. The model only chooses
// among moves this file accepts, and gives the reason for each.

type Span = { s: number; e: number };
export type Change =
  { action: "move"; start: number; end: number; reason: string } | { action: "drop"; reason: string };
export type Outcome = { ok: true; [k: string]: unknown } | { ok: false; problem: string };

const MIN = 60_000;
const STEP = 5 * MIN;
/** Changes in one rebuild, the missed item included. Fewer is better; more than this isn't a recovery, it's a new plan. */
export const MAX_CHANGES = 3;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const WITH_SECONDS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):00(\.0+)?$/;
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function merged(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const x of [...spans].sort((a, b) => a.s - b.s)) {
    const last = out.at(-1);
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e);
    else out.push({ ...x });
  }
  return out;
}

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

const span = (start: string, end: string): Span => ({ s: Date.parse(start), e: Date.parse(end) });
const minutes = (x: Span) => Math.round((x.e - x.s) / MIN);

// Reasons are the model's words in a message the person reads. Code keeps them
// short, calm, and free of times (code writes those, so they're always right).
const UNKIND =
  /\b(streaks?|fail(ed|ure|ing)?|lazy|should(n't)? have|disappoint\w*|guilt\w*|don'?t worry|you('ve)? got this|great job|awesome|amazing|proud|hurry|asap|urgent\w*|no excuses?|you (missed|skipped|didn'?t))\b|!/i;
const CLOCK = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}:\d{2}\b/i;

export const unkind = (text: string) => UNKIND.test(text);

/** Replies that say part was done: what's left is shorter on purpose, so "there's room for more" doesn't apply. */
const PARTIAL = /\b(half|partial(ly)?|part of|some of|got through|did \d+|\d+ ?%|most of)\b/i;

/**
 * What their reply means for the plan, in a form code can apply and word: the agent reads the reply and notes it with
 * the exact words it rests on; code checks those words are in the reply and say that, keeps the missed session out of
 * what it rules out, and writes the paraphrase ("so tonight can be off", "since you said only mornings work this week").
 * Nothing in a message paraphrases the reply any other way.
 */
export type ReplyKind = "not_today" | "not_before" | "only_part" | "partial" | "from_day";
export type ReplyNote = {
  kind: ReplyKind;
  quote: string;
  at: number | null;
  part: "morning" | "afternoon" | "evening" | null;
  phrase: string;
};
const NOTE_WORDS: Record<ReplyKind, RegExp> = {
  not_today: /\b(tonight|today|tired|exhausted|sick|ill|fever|late|cansad[oa]|noche|hoy)\b/i,
  not_before: /\b(until|till|til|after|busy|free)\b|\b\d{1,2}(:\d{2})?\s?(am|pm)?\b/i,
  only_part: /\b(mornings?|afternoons?|evenings?|nights?)\b/i,
  partial: /\b(half|partial(ly)?|part of|some of|got through|did \d+|\d+ ?%|most of)\b/i,
  from_day: /\b(tomorrow|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
};
const PART_WORDS = { morning: /morning/i, afternoon: /afternoon/i, evening: /evening|night/i } as const;
const PART_HOURS = { morning: [0, 12], afternoon: [12, 17], evening: [17, 24] } as const;
const normal = (s: string) =>
  plain(s)
    .toLowerCase()
    .replace(/[^a-z0-9%: ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** One SMS segment: the recovery text never runs longer. */
export const MAX_TEXT = 160;

/**
 * Plain characters only, so the text is one cheap SMS segment on every phone:
 * smart quotes and dashes become ASCII, accents drop, anything else non-ASCII goes.
 */
export function plain(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00a0\u202f]/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// A reply that says they're unwell gets one line of care before the moves, and no reasons after it.
const UNWELL =
  /\b(sick|ill|fever|flu|covid|unwell|migraine|throwing up|not feeling (well|good)|feel(ing)? (awful|terrible))\b/i;

export function checkReason(raw: string): { ok: true; reason: string } | { ok: false; problem: string } {
  const reason = plain(raw)
    .replace(/^because\s+/i, "")
    .replace(/[.\s]+$/, "");
  if (reason.length < 3) return { ok: false, problem: "Give a short reason." };
  if (reason.length > 120) return { ok: false, problem: "Keep the reason under 120 characters." };
  if (CLOCK.test(reason)) return { ok: false, problem: "Leave clock times out of the reason; Lens adds the time." };
  if (UNKIND.test(reason))
    return {
      ok: false,
      problem: "Plain, calm words only: no guilt, praise, urgency, exclamation marks, or mention of the miss.",
    };
  return { ok: true, reason };
}

export class Draft {
  readonly changes = new Map<string, Change>();
  /** What their reply means, once the agent notes it (noteReply). */
  note: ReplyNote | null = null;
  /** Items already told once that their stretch holds more: a second, identical ask stands (a partial session). */
  private toldRoom = new Set<string>();
  readonly now: number;
  readonly zone: string;

  /** What the rules keep everything out of (src/lib/rebuild/rules.ts): sleep, the hour before bed, quiet hours. */
  readonly off: RuleSpan[];
  /** The 90 minutes after the missed session, when its deadline isn't within 24 hours. */
  readonly gap: RuleSpan | null;

  constructor(readonly req: RebuildRequest) {
    this.now = Date.parse(req.now);
    this.zone = req.zone;
    const horizon = Math.max(this.now, ...req.open_windows.map((w) => Date.parse(w.end)), ...req.items.map((i) => Date.parse(i.end)), ...req.deadlines.map((d) => Date.parse(d.due))); // prettier-ignore
    this.off = blocked(req, this.now, horizon);
    this.gap = missGap(req);
  }

  get missed(): RebuildPlanned {
    return this.req.items.find((i) => i.id === this.req.missed.item_id)!;
  }

  item(id: string) {
    return this.req.items.find((i) => i.id === id);
  }

  deadline(i: RebuildPlanned) {
    return i.for ? this.req.deadlines.find((d) => d.id === i.for) : undefined;
  }

  /** The latest it can finish: its own due time or its deadline's, whichever is sooner. */
  dueBy(i: RebuildPlanned): number | null {
    const times = [i.due, this.deadline(i)?.due].filter((x): x is string => !!x).map(Date.parse);
    return times.length ? Math.min(...times) : null;
  }

  length(i: RebuildPlanned) {
    return minutes(span(i.start, i.end));
  }

  shortest(i: RebuildPlanned) {
    return Math.min(i.min_minutes ?? 30, this.length(i));
  }

  placement(i: RebuildPlanned): Span | null {
    const c = this.changes.get(i.id);
    if (c?.action === "drop") return null;
    if (c?.action === "move") return { s: c.start, e: c.end };
    return i.status === "missed" ? null : span(i.start, i.end);
  }

  /**
   * Free time from now on, in 5-minute steps: Tomorrow's open windows, plus the
   * slots of items moved or dropped (and the item's own, for `except`), minus
   * busy time and every other item where it now sits.
   */
  free(except?: string): Span[] {
    const open = [
      ...this.req.open_windows.map((w) => span(w.start, w.end)),
      ...this.req.items
        .filter((i) => i.status === "planned" && (this.changes.has(i.id) || i.id === except))
        .map((i) => span(i.start, i.end)),
    ];
    const busy = [
      ...this.req.fixed.map((f) => span(f.start, f.end)),
      ...this.req.items.filter((i) => i.id !== except).flatMap((i) => this.placement(i) ?? []),
    ];
    // The rules' time is never free, whatever Tomorrow's windows say; nor, for the missed item, what their reply rules out.
    const ruledOut = except === this.missed.id ? this.replyBlock() : [];
    return minus(merged(open), [...busy, ...this.off, ...(this.gap ? [this.gap] : []), ...ruledOut])
      .map((x) => ({ s: Math.ceil(Math.max(x.s, this.now) / STEP) * STEP, e: x.e }))
      .filter((x) => x.e - x.s >= STEP);
  }

  /** Why a span breaks a rule, in words for the model; null when it breaks none. */
  ruleProblem(x: Span): string | null {
    const hit = (b: Span) => b.s < x.e && x.s < b.e;
    if (this.gap && hit(this.gap))
      return `That's within ${MISS_GAP_MIN} minutes of the missed session; it can start from ${this.day(this.gap.e)} ${this.hhmm(this.gap.e)}.`; // prettier-ignore
    const night = nights(this.req, x.s, x.e).find((n) => x.s < n.wake && n.bed - SLEEP_BUFFER_MIN * MIN < x.e);
    if (night)
      return x.s >= night.bed - SLEEP_BUFFER_MIN * MIN && x.s < night.bed
        ? `That's within an hour of bedtime (${this.hhmm(night.bed)}); it has to finish by ${this.hhmm(night.bed - SLEEP_BUFFER_MIN * MIN)}.`
        : x.s >= night.bed
          ? `That's while they sleep (${this.hhmm(night.bed)}-${this.hhmm(night.wake)}).`
          : `It would run into the hour before bedtime (${this.hhmm(night.bed)}); it has to finish by ${this.hhmm(night.bed - SLEEP_BUFFER_MIN * MIN)}.`; // prettier-ignore
    if (this.off.some(hit)) return "That's in their quiet hours, or outside their study hours.";
    return null;
  }

  /** Time the noted reply rules out for the missed item. */
  replyBlock(): Span[] {
    const n = this.note;
    if (!n) return [];
    const tomorrow = this.local(this.now).plus({ days: 1 }).startOf("day").toMillis();
    if (n.kind === "not_today") return [{ s: this.now, e: tomorrow }];
    if ((n.kind === "not_before" || n.kind === "from_day") && n.at) return [{ s: this.now, e: n.at }];
    if (n.kind === "only_part" && n.part) {
      const [a, b] = PART_HOURS[n.part];
      const out: Span[] = [];
      for (let k = 0; k < 15; k++) {
        const day = this.local(this.now).plus({ days: k }).startOf("day");
        if (a > 0) out.push({ s: day.toMillis(), e: day.plus({ hours: a }).toMillis() });
        if (b < 24) out.push({ s: day.plus({ hours: b }).toMillis(), e: day.plus({ days: 1 }).toMillis() });
      }
      return out;
    }
    return [];
  }

  /** Records what their reply means, from words in it that say so; code applies and words it. */
  noteReply(
    kind: ReplyKind,
    quote: string,
    until: string | null,
    fromDate: string | null,
    part: ReplyNote["part"],
  ): Outcome {
    const reply = this.req.missed.reply;
    if (!reply) return { ok: false, problem: "They didn't reply; there's nothing to note." };
    if (!quote.trim() || !normal(reply).includes(normal(quote)))
      return { ok: false, problem: `Quote their exact words; ${JSON.stringify(quote)} isn't in their reply ${JSON.stringify(reply)}.` }; // prettier-ignore
    if (!NOTE_WORDS[kind].test(quote))
      return { ok: false, problem: `${JSON.stringify(quote)} doesn't say that (${kind}).` };
    let at: number | null = null;
    if (kind === "not_before") {
      const t = until ? this.parseLocal(until) : 'Give until: when they\'re free from, "YYYY-MM-DDTHH:mm".';
      if (typeof t === "string") return { ok: false, problem: t };
      if (t <= this.now) return { ok: false, problem: "That time has passed." };
      at = t;
    }
    if (kind === "from_day") {
      const t = fromDate ? this.parseLocal(`${fromDate}T00:00`) : 'Give from_date, "YYYY-MM-DD".';
      if (typeof t === "string") return { ok: false, problem: t };
      at = Math.max(t, this.now);
    }
    if (kind === "only_part" && (!part || !PART_WORDS[part].test(quote)))
      return { ok: false, problem: `Give part (morning, afternoon, or evening) as their words say it.` };
    const noun = quote.match(/\b([a-z]+)\s+(?:until|till|til)\b/i)?.[1]?.toLowerCase();
    const notNoun = ["busy", "be", "am", "im", "out", "tomorrow", "today", "tonight", "day", "week", "morning", "afternoon", "evening", "all"]; // prettier-ignore
    const phrase =
      kind === "not_today"
        ? this.local(this.now).hour >= 17 ? "so tonight can be off" : "so today can be off"
        : kind === "not_before"
          ? noun && !notNoun.includes(noun) ? `after ${noun}` : "once you're free"
          : kind === "only_part"
            ? `since you said only ${part}s work${/this week/i.test(quote) ? " this week" : ""}`
            : kind === "partial"
              ? /half/i.test(quote) ? "for the half that's left" : "for the part that's left"
              : /weekend/i.test(quote)
                ? "on the weekend, as you said"
                : /tomorrow/i.test(quote)
                  ? "so today can be off"
                  : `on ${this.local(at!).toFormat("cccc")}, as you said`; // prettier-ignore
    this.note = { kind, quote, at, part: kind === "only_part" ? part : null, phrase };
    return { ok: true, noted: kind, words: phrase };
  }

  /**
   * A time their noted reply offers ("can do it later today after 6"): from then to the end of that day. "Practice until
   * 9" says when they're busy, not that they want 9pm, so it offers nothing.
   */
  offered(): Span | undefined {
    const n = this.note;
    if (n?.kind !== "not_before" || !n.at || !/\b(can|could|i'?ll|will|free after|after \d)/i.test(n.quote))
      return undefined;
    return { s: n.at, e: this.local(n.at).endOf("day").toMillis() };
  }

  /** The factors code checked true of placing `id` at [s, s + minutes): what its reason may say. */
  factorsAt(id: string, s: number, minutes: number): Factor[] {
    const offered = id === this.missed.id ? this.offered() : undefined;
    return rankSlots(this, id, { minutes, at: s, offered })[0]?.factors ?? [];
  }

  // Times as people read them, always in their zone.
  local = (ms: number) => DateTime.fromMillis(ms, { zone: this.zone });
  instant = (ms: number) => this.local(ms).toISO({ suppressMilliseconds: true })!;
  stamp = (ms: number) => this.local(ms).toFormat("yyyy-MM-dd'T'HH:mm");
  day = (ms: number) => this.local(ms).toFormat("ccc LLL d");
  hhmm = (ms: number) => this.local(ms).toFormat("HH:mm");
  at = (x: Span) => `${this.day(x.s)} ${this.hhmm(x.s)}-${this.hhmm(x.e)}`;

  /** "7pm today", "9:30am tomorrow", "Thu 4pm", "Thu Nov 12, 4pm". */
  when(ms: number): string {
    const { clock, day } = this.whenParts(ms);
    if (day === "today" || day === "tomorrow") return `${clock} ${day}`;
    return day.includes(" ") ? `${day}, ${clock}` : `${day} ${clock}`;
  }

  whenParts(ms: number): { clock: string; day: string } {
    const d = this.local(ms);
    const days = Math.round(d.startOf("day").diff(this.local(this.now).startOf("day"), "days").days);
    const clock = d.toFormat(d.minute ? "h:mma" : "ha").toLowerCase();
    const day = days === 0 ? "today" : days === 1 ? "tomorrow" : days > 1 && days < 7 ? d.toFormat("ccc") : d.toFormat("ccc LLL d"); // prettier-ignore
    return { clock, day };
  }

  parseLocal(raw: string): number | string {
    // An instant with an offset is unambiguous; seconds of :00 are just noise.
    if (WITH_OFFSET.test(raw)) {
      const d = DateTime.fromISO(raw);
      return d.isValid ? d.toMillis() : 'Write times as "YYYY-MM-DDTHH:mm" in their zone.';
    }
    const text = raw.replace(WITH_SECONDS, "$1");
    if (!LOCAL.test(text))
      return `Write times as "YYYY-MM-DDTHH:mm" in their zone (got ${JSON.stringify(raw.slice(0, 40))}).`;
    const d = DateTime.fromISO(text, { zone: this.zone });
    // A wall-clock time skipped when clocks spring forward comes back shifted.
    if (!d.isValid || d.toFormat("yyyy-MM-dd'T'HH:mm") !== text)
      return "That time doesn't exist that day (clocks change).";
    return d.toMillis();
  }

  freeOn(dayStart: number, except?: string) {
    const end = this.local(dayStart).endOf("day").toMillis();
    return this.free(except)
      .filter((x) => x.e > dayStart && x.s < end)
      .map((x) => `${this.hhmm(Math.max(x.s, dayStart))}-${this.hhmm(Math.min(x.e, end))}`);
  }

  /** How many minutes `id` could run from `s` in free time, before its deadline (5-minute steps). */
  room(id: string, s: number): number {
    const due = this.dueBy(this.item(id)!) ?? Infinity;
    const x = this.free(id).find((y) => y.s <= s && s < y.e);
    return x ? Math.floor((Math.min(x.e, due) - s) / STEP) * 5 : 0;
  }

  /**
   * `because`: for the missed item, 1-2 keys of the slot's factors (and "reply" once noted), which code words; for any
   * other item, a short reason in words.
   */
  move(id: string, start: string, durationMin: number | null, because: string | string[]): Outcome {
    const i = this.item(id);
    if (!i) return { ok: false, problem: `There's no item ${id}. Use an id from the list.` };
    const missed = id === this.missed.id;
    const keys = Array.isArray(because) ? because : null;
    if (missed && (!keys || !keys.length || keys.length > 2))
      return { ok: false, problem: 'For the missed item, give because: 1 or 2 keys from the slot\'s factors (or "reply").' }; // prettier-ignore
    const reason = keys ? { ok: true as const, reason: "" } : checkReason(String(because));
    if (!reason.ok) return reason;
    // What they said is only ever worded by code, from a noted reply.
    if (!missed && /\byou(?:'re| are| said| asked| mentioned| told| did)\b/i.test(reason.reason))
      return { ok: false, problem: "Don't put their reply in your own words; note_reply it, and code words it." };
    const s = this.parseLocal(start);
    if (typeof s === "string") return { ok: false, problem: s };
    const full = this.length(i);
    const mins = durationMin ?? full;
    if (mins > full) return { ok: false, problem: `It can't get longer than it was (${full} min).` };
    if (mins < this.shortest(i)) return { ok: false, problem: `The shortest version is ${this.shortest(i)} min.` };
    if (s % STEP) return { ok: false, problem: "Start on a 5-minute mark." };
    const e = s + mins * MIN;
    if (s < this.now)
      return { ok: false, problem: `That's in the past; it's ${this.day(this.now)} ${this.hhmm(this.now)} now.` };
    const due = this.dueBy(i);
    if (due !== null && e > due) {
      const d = this.deadline(i);
      return {
        ok: false,
        problem: `It has to finish by ${this.day(due)} ${this.hhmm(due)}${d ? ` (${d.title})` : ""}.`,
      };
    }
    if (i.status === "planned" && s === Date.parse(i.start) && e === Date.parse(i.end))
      return { ok: false, problem: "That's where it already is." };
    const rule = this.ruleProblem({ s, e });
    if (rule) return { ok: false, problem: rule };
    if (missed && this.replyBlock().some((b) => b.s < e && s < b.e))
      return { ok: false, problem: `Their reply rules that out (${JSON.stringify(this.note!.quote)}).` };
    if (!this.free(id).some((x) => x.s <= s && e <= x.e)) {
      const day = this.freeOn(this.local(s).startOf("day").toMillis(), id);
      return {
        ok: false,
        problem: `${this.at({ s, e })} isn't free. Free that day: ${day.length ? day.join(", ") : "nothing"}.`,
      };
    }
    // Shorten only as much as the stretch needs: if it holds more, say so once.
    const room = this.room(id, s);
    const partial = id === this.missed.id && !!this.req.missed.reply && PARTIAL.test(this.req.missed.reply);
    if (mins < full && room > mins && !partial && !this.toldRoom.has(`${id}@${s}:${mins}`)) {
      this.toldRoom.add(`${id}@${s}:${mins}`);
      return {
        ok: false,
        problem: `From ${this.hhmm(s)} it can run ${Math.min(room, full)} min before the next thing or its deadline. Shorten only as much as you must; if they said they did part of it, ask for ${mins} again.`, // prettier-ignore
      };
    }
    let words = reason.reason;
    if (missed) {
      // Code words the reason, from what it checked true of this exact time.
      const factors = this.factorsAt(id, s, mins);
      const offered = [...factors, ...(this.note ? [{ key: "reply", text: this.note.phrase }] : [])];
      const unknown = keys!.filter((k) => !offered.some((f) => f.key === k));
      if (unknown.length)
        return {
          ok: false,
          problem: `Not true of this time: ${unknown.join(", ")}. True of it: ${offered.length ? offered.map((f) => `${f.key} ("${f.text}")`).join(", ") : "nothing that ranks it; pick another time"}.`, // prettier-ignore
        };
      const chosen = [...offered].filter((f) => keys!.includes(f.key));
      chosen.sort((a, b) => (a.key === "reply" ? -1 : b.key === "reply" ? 1 : FACTOR_ORDER.indexOf(a.key as Factor["key"]) - FACTOR_ORDER.indexOf(b.key as Factor["key"]))); // prettier-ignore
      words = compose(chosen);
    }
    this.changes.set(id, { action: "move", start: s, end: e, reason: words });
    return { ok: true, moved: i.title, to: this.at({ s, e }), minutes: mins, reason: words };
  }

  drop(id: string, rawReason: string): Outcome {
    const i = this.item(id);
    if (!i) return { ok: false, problem: `There's no item ${id}. Use an id from the list.` };
    const reason = checkReason(rawReason);
    if (!reason.ok) return reason;
    if (/\byou(?:'re| are| said| asked| mentioned| told| did)\b/i.test(reason.reason))
      return { ok: false, problem: "Don't put their reply in your own words; note_reply it, and code words it." };
    this.changes.set(id, { action: "drop", reason: reason.reason });
    return { ok: true, dropped: i.title };
  }

  undo(id: string): Outcome {
    const i = this.item(id);
    if (!i || !this.changes.has(id)) return { ok: false, problem: `Nothing to undo for ${id}.` };
    if (i.status === "planned") {
      const own = span(i.start, i.end);
      const taken = this.req.items.some((o) => {
        const p = o.id === id ? null : this.placement(o);
        return p && p.s < own.e && own.s < p.e;
      });
      if (taken) return { ok: false, problem: "Its old time is taken now; move what's there first." };
    }
    this.changes.delete(id);
    return { ok: true, back: i.title };
  }

  finish(): Outcome {
    if (!this.changes.has(this.missed.id))
      return { ok: false, problem: "The missed item still needs a move or a drop." };
    if (this.changes.size > MAX_CHANGES)
      return { ok: false, problem: `That changes ${this.changes.size} items; change at most ${MAX_CHANGES} (fewer is better).` }; // prettier-ignore
    const text = this.message();
    if (text.length > MAX_TEXT)
      return { ok: false, problem: `The text would be ${text.length} characters; it must fit in ${MAX_TEXT}. Shorten the reasons.` }; // prettier-ignore
    return { ok: true };
  }

  diff(): DiffEntry[] {
    return this.req.items.map((i) => {
      const c = this.changes.get(i.id);
      if (!c) return { item_id: i.id, action: "keep", start: null, end: null, reason: null };
      return c.action === "move"
        ? { item_id: i.id, action: "move", start: this.instant(c.start), end: this.instant(c.end), reason: c.reason }
        : { item_id: i.id, action: "drop", start: null, end: null, reason: c.reason };
    });
  }

  /**
   * When the missed item can't fit before its deadline, the best a person could
   * still do: a 15-minute version ending 90 minutes before it (time to get
   * there), not before 7 AM, not overlapping anything. Outside the free time
   * Tomorrow sent, so it's only offered, never placed: the text asks.
   */
  /** Whether the missed item's shortest version still fits in free time before it's due. */
  fitsBeforeDue(): boolean {
    const m = this.missed;
    const due = this.dueBy(m) ?? Infinity;
    return this.free(m.id).some((x) => Math.min(x.e, due) - x.s >= this.shortest(m) * MIN);
  }

  offer(): { item_id: string; start: number; end: number } | null {
    const m = this.missed;
    if (this.changes.get(m.id)?.action !== "drop") return null;
    const due = this.dueBy(m);
    // Only when nothing fits: a drop while time is free was their choice (their reply), not a lack of time.
    if (due === null || this.fitsBeforeDue()) return null;
    const busy = [
      ...this.req.fixed.map((f) => span(f.start, f.end)),
      ...this.req.items.filter((i) => i.id !== m.id).flatMap((i) => this.placement(i) ?? []),
    ];
    for (let s = due - 105 * MIN; s >= this.now; s -= 15 * MIN) {
      const e = s + 15 * MIN;
      if (this.local(s).hour < 7) break;
      if (busy.some((b) => b.s < e && s < b.e)) continue;
      // An offer the person accepts becomes a move, so it keeps the same rules (not the 90 minutes: it's due soon).
      if (this.off.some((b) => b.s < e && s < b.e)) continue;
      return { item_id: m.id, start: s, end: e };
    }
    return null;
  }

  /**
   * The one recovery text, built by code from the changes and the model's
   * reasons, so it says exactly what the diff does: one SMS segment, plain
   * characters, missed item first, and always "Nothing else changed."
   */
  message(): string {
    const m = this.missed;
    const title = (id: string) => plain(this.item(id)!.title);
    // The missed item first, then the rest in the plan's order: the same text however the moves were made.
    const ids = [m.id, ...this.req.items.map((i) => i.id).filter((id) => id !== m.id && this.changes.has(id))];
    const moves = ids.filter((id) => this.changes.get(id)?.action === "move");
    const shorter = (id: string) => {
      const c = this.changes.get(id) as Extract<Change, { action: "move" }>;
      const mins = minutes({ s: c.start, e: c.end });
      const full = this.length(this.item(id)!);
      return mins < full ? `, ${mins} min instead of ${full},` : "";
    };
    // "Calc practice to 8am, Essay outline to 2pm and Read HIST ch. 4 to 3pm tomorrow"
    const startOf = (id: string) => (this.changes.get(id) as Extract<Change, { action: "move" }>).start;
    const list = (xs: string[]) => {
      const parts = xs.map((id) => ({ id, ...this.whenParts(startOf(id)) }));
      // Several moves the same day share it once ("... to 2pm and ... to 3pm tomorrow"); shortened ones say so in full.
      const oneDay =
        parts.length > 1 &&
        parts.every((p) => p.day === parts[0].day && !shorter(p.id)) &&
        ["today", "tomorrow"].includes(parts[0].day);
      const each = parts.map((p) => `${title(p.id)} to ${oneDay ? p.clock : this.when(startOf(p.id))}${shorter(p.id)}`);
      const joined = each.length > 1 ? `${each.slice(0, -1).join(", ")} and ${each.at(-1)}` : each[0];
      return oneDay ? `${joined} ${parts[0].day}` : joined;
    };
    const unwell = !!this.req.missed.reply && UNWELL.test(this.req.missed.reply);
    let text: string;
    if (unwell && moves.length === ids.length) {
      text = `Feel better. Moved ${list(moves)}.`;
    } else {
      const lines = ids.map((id) => {
        const c = this.changes.get(id)!;
        const deadline = this.deadline(this.item(id)!);
        if (c.action === "drop") {
          if (id === m.id && this.dueBy(m) !== null && !this.fitsBeforeDue()) {
            const before = deadline ? plain(deadline.title) : "it's due";
            const o = this.offer();
            return o
              ? `Not enough free time before ${before}. Want a 15-min version at ${this.when(o.start)}, or skip it?`
              : `Not enough free time before ${before}, so ${title(id)} is off the plan.`;
          }
          return `Took ${title(id)} off the plan because ${c.reason}.`;
        }
        // Another session moved out of the way for the missed one.
        const room =
          id !== m.id &&
          this.changes.get(m.id)?.action === "move" &&
          (() => {
            const mc = this.changes.get(m.id) as Extract<Change, { action: "move" }>;
            const old = span(this.item(id)!.start, this.item(id)!.end);
            return old.s < mc.end && mc.start < old.e;
          })();
        if (room) return `Moved ${list([id])} to make room.`;
        // The missed item's reason is code's own words from verified factors: "Moved X to Thu 2pm, a lighter afternoon".
        if (id === m.id) {
          const head = list([id]);
          return `Moved ${head}${head.endsWith(",") ? "" : ","} ${c.reason}.`;
        }
        return `Moved ${list([id])} because ${c.reason}.`;
      });
      text = `${unwell ? "Feel better. " : ""}${lines.join(" ")}`;
    }
    return plain(`${text} Nothing else changed.`);
  }

  response(decided_by: RebuildResponse["decided_by"]): RebuildResponse {
    const o = this.offer();
    const offer = o ? { item_id: o.item_id, start: this.instant(o.start), end: this.instant(o.end) } : null;
    return { version: 1, diff: this.diff(), message: this.message(), offer, decided_by };
  }
}

/**
 * Code's own answer, used when the model can't be: the missed item goes in the
 * first free time that fits before it's due (full length, else its shortest
 * version), or is dropped when nothing fits. Nothing else changes.
 */
/** Replies that rule out the rest of today: a cheap reading in code, for the agent's check and code's fallback. */
export const TODAY_OUT =
  /\b(not tonight|not today|too tired|too late|exhausted|tomorrow|sick|ill|fever|tonight is out|can'?t (do it )?(today|tonight)|cansad[oa]|mañana|demain)\b/i;

export function fallback(req: RebuildRequest): Draft {
  const d = new Draft(req);
  const m = d.missed;
  const due = d.dueBy(m);
  const what = d.deadline(m)?.title ?? "it's due";
  // Even without the model, a reply that rules out today is kept.
  const out = !!req.missed.reply && TODAY_OUT.test(req.missed.reply);
  const from = out ? d.local(d.now).plus({ days: 1 }).startOf("day").toMillis() : d.now;
  // Code's own best slot (the same ranking the agent uses), worded from its top two verified factors. Set directly, not
  // through move(): the slot is already known to fit.
  const best = rankSlots(d, m.id, { after: from })[0];
  if (best) {
    const top = [...best.factors].sort((a, b) => FACTOR_ORDER.indexOf(a.key) - FACTOR_ORDER.indexOf(b.key));
    const chosen = [...top.filter((f) => f.key !== "buffer").slice(0, out ? 0 : 1), ...top.filter((f) => f.key === "buffer")]; // prettier-ignore
    const texts = [...(out ? [{ key: "reply", text: d.local(d.now).hour >= 17 ? "so tonight can be off" : "so today can be off" }] : []), ...chosen]; // prettier-ignore
    const reason = compose(texts) || (due === null ? "the first good time open" : `the first good time before ${what}`);
    d.changes.set(m.id, { action: "move", start: best.start, end: best.start + best.minutes * MIN, reason });
    return d;
  }
  const reason =
    due === null ? "there's no open time in the days Tomorrow shared" : `there's no open time before ${what}`;
  d.changes.set(m.id, { action: "drop", reason });
  return d;
}

/**
 * Checks a finished rebuild from scratch, independent of how it was made: every
 * item listed once in order, every move in the future, inside free time, before
 * it's due, within its length, and a message that says exactly what the diff
 * does. The route sends nothing that fails this; evals count what does.
 */
export function checkResponse(req: RebuildRequest, res: RebuildResponse): string[] {
  const problems: string[] = [];
  if (res.diff.length !== req.items.length || res.diff.some((x, n) => x.item_id !== req.items[n].id))
    problems.push("the diff doesn't list every item once, in order");
  const d = new Draft(req);
  for (const x of res.diff) {
    if (x.action === "keep") continue;
    // Fallback reasons are code's own, built from titles the person wrote.
    if (res.decided_by === "agent" && !(x.reason && checkReason(x.reason).ok)) problems.push(`${x.item_id}: reason`);
    if (x.action === "drop") d.changes.set(x.item_id, { action: "drop", reason: x.reason ?? "" });
    else if (!x.start || !x.end) problems.push(`${x.item_id}: a move without a time`);
    else d.changes.set(x.item_id, { action: "move", start: Date.parse(x.start), end: Date.parse(x.end), reason: x.reason ?? "" }); // prettier-ignore
  }
  const done = d.finish();
  if (!done.ok) problems.push(done.problem);
  for (const [id, c] of d.changes) {
    if (c.action !== "move") continue;
    const i = d.item(id)!;
    const mins = minutes({ s: c.start, e: c.end });
    const due = d.dueBy(i);
    if (c.start < d.now) problems.push(`${id}: in the past`);
    if (due !== null && c.end > due) problems.push(`${id}: ends after it's due`);
    if (mins > d.length(i) || mins < d.shortest(i)) problems.push(`${id}: ${mins} min is outside its length`);
    if (!d.free(id).some((x) => x.s <= c.start && c.end <= x.e)) problems.push(`${id}: not free time`);
  }
  if (!problems.length && res.message !== d.message()) problems.push("the message doesn't match the diff");
  if (res.message.length > MAX_TEXT || plain(res.message) !== res.message)
    problems.push("the message isn't one plain SMS segment");
  problems.push(...hardRuleViolations(req, res));
  const o = d.offer();
  if (JSON.stringify(res.offer ?? null) !== JSON.stringify(o ? { item_id: o.item_id, start: d.instant(o.start), end: d.instant(o.end) } : null)) problems.push("the offer doesn't match the plan"); // prettier-ignore
  return problems;
}
