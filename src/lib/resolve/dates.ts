import { DateTime } from "luxon";

// Dates and times are resolved here, in code, from the words the model copied
// out of the source ("Week 7 Thu", "Fri Oct 30", "11/3", "Mon", "11:59pm").
// Nothing is guessed: when the words allow more than one date, or need a fact we
// don't have (the term start, when a photo was taken), the result says so and
// the caller asks one question. Calendar dates are plain ISO dates (2026-10-30);
// they only become instants, in the person's zone, in `toInstant`.

/** ISO weekday, Monday = 1 ... Sunday = 7, as Luxon numbers them. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type DateRule = "month_day" | "numeric" | "week_of_term" | "weekday_after" | "relative_day" | "offset";

/** The facts a date can depend on, as ISO dates. Recorded with every resolved date so it can be recomputed. */
export type DateInputs = {
  /** First day of classes. Needed for "Week 7 Thu", and the year for "Oct 30" in a syllabus. */
  term_start: string | null;
  /** The day a photo was taken (in the person's zone). Needed for "Mon", "tomorrow", "Fri". */
  photo_date: string | null;
  /** The day the source was added to Lens. Only ever used to pick the year of "Oct 30". */
  added_date: string | null;
  /** Last day of classes. Only for a class's last meeting. */
  term_end?: string | null;
  /** The item a date like "before Midterm 1" depends on, and that item's date when this one was computed. */
  ref?: { item_id: string; date: string } | null;
  /** For a date the person gave: the question they answered. */
  answer?: string;
};

export type DateResult =
  | { ok: true; date: string; rule: DateRule }
  | {
      ok: false;
      /** Plain words for the person, e.g. "Oct 31, 2026 is a Saturday, not a Friday". */
      reason: string;
      /** What would settle it: a fact to ask for, or a choice between dates. */
      needs: "term_start" | "photo_date" | "choice" | "rewrite" | "reference";
      /** Candidate ISO dates when it's a choice, most likely first. */
      options: string[];
    };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
}; // prettier-ignore

const WEEKDAYS: Record<string, Weekday> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, tu: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4,
  thurs: 4, thursday: 4, th: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
}; // prettier-ignore

export const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const MONTH_RE = Object.keys(MONTHS).join("|");
const WEEKDAY_RE = Object.keys(WEEKDAYS)
  .sort((a, b) => b.length - a.length)
  .join("|");

function day(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: "utc" });
}
function iso(d: DateTime): string {
  return d.toISODate()!;
}
function fail(reason: string, needs: Extract<DateResult, { ok: false }>["needs"], options: string[] = []): DateResult {
  return { ok: false, reason, needs, options };
}
export function formatDate(isoDate: string): string {
  return day(isoDate).toFormat("ccc MMM d");
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[,.()!?;:@]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A month and day with no year belong to the year that puts them within the
 * term (or within the coming months of a photo): from 60 days before the anchor
 * to 305 days after it. That window holds exactly one such date.
 */
function inferYear(month: number, dayOfMonth: number, anchor: string): DateTime | null {
  const a = day(anchor);
  for (const y of [a.year - 1, a.year, a.year + 1]) {
    const d = DateTime.utc(y, month, dayOfMonth);
    if (!d.isValid) continue;
    const diff = d.diff(a, "days").days;
    if (diff >= -60 && diff < 305) return d;
  }
  return null;
}

function nearestWithWeekday(d: DateTime, wd: Weekday): DateTime {
  const fwd = (wd - d.weekday + 7) % 7;
  return fwd <= 3 ? d.plus({ days: fwd }) : d.minus({ days: 7 - fwd });
}

const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, the: 1, two: 2, three: 3, four: 4 };

export type Relative = {
  /** What it's relative to, as written: "Midterm 1", "the project", "Wed". */
  ref: string;
  /** Days from that date: "before X" is 0 (due by X), "the day after X" is 1, "the week before X" is -7. */
  offset_days: number;
};

/**
 * Splits "before Midterm 1", "the week after the project", "2 days before Exam 2" into what it's relative to and how
 * far from it. null when the words aren't relative, or don't say how far ("after the midterm" alone).
 */
export function parseRelative(text: string): Relative | null {
  const t = normalize(text).replace(/^due\s+/, "");
  const m = /^(?:(a|an|one|the|two|three|four|\d+)\s+(days?|weeks?)\s+)?(before|after|prior to|by)\s+(.+)$/.exec(t);
  if (!m) return null;
  const [, count, unit, dir, ref] = m;
  if (!unit && dir === "after") return null;
  const n = unit ? (COUNT[count] ?? Number(count)) * (unit.startsWith("week") ? 7 : 1) : 0;
  return { ref: ref.trim(), offset_days: dir === "after" || n === 0 ? n : -n };
}

/** Resolves a date as written. Pure: the same text and inputs always give the same answer. */
export function resolveDate(text: string, inputs: DateInputs): DateResult {
  // "the day before Oct 30" is Oct 29; "before Midterm 1" depends on another item, which the caller looks up.
  const rel = parseRelative(text);
  if (rel) {
    const inner = resolveDate(rel.ref, inputs);
    if (inner.ok)
      return rel.offset_days === 0
        ? inner
        : { ok: true, date: iso(day(inner.date).plus({ days: rel.offset_days })), rule: "offset" };
    if (inner.needs === "rewrite")
      return inputs.ref
        ? { ok: true, date: iso(day(inputs.ref.date).plus({ days: rel.offset_days })), rule: "offset" }
        : fail(`"${text}" depends on when ${rel.ref} is`, "reference");
    return inner;
  }
  const t = normalize(text);
  const weekdayWords = [...t.matchAll(new RegExp(`\\b(${WEEKDAY_RE})\\b`, "g"))].map((m) => WEEKDAYS[m[1]]);
  const weekday = weekdayWords[0] ?? null;
  if (new Set(weekdayWords).size > 1) return fail(`"${text}" names more than one day`, "rewrite");

  // "Week 7 Thu": week 1 is the Monday-to-Sunday week the term starts in.
  const week = /\bweek\s*(\d{1,2})\b/.exec(t);
  if (week) {
    if (!weekday) return fail(`"${text}" doesn't say which day of week ${week[1]}`, "rewrite");
    if (!inputs.term_start) return fail(`"${text}" needs the first day of classes`, "term_start");
    const monday = day(inputs.term_start).startOf("week");
    return {
      ok: true,
      date: iso(monday.plus({ weeks: Number(week[1]) - 1, days: weekday - 1 })),
      rule: "week_of_term",
    };
  }

  const numeric = [...t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g)];
  const named = [...t.matchAll(new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(\\d{4}))?`, "g"))];
  const found = [
    ...numeric.map((m) => ({ month: Number(m[1]), day: Number(m[2]), year: m[3], rule: "numeric" as const })),
    ...named.map((m) => ({ month: MONTHS[m[1]], day: Number(m[2]), year: m[3], rule: "month_day" as const })),
  ];
  if (found.length > 1) return fail(`"${text}" has more than one date in it`, "rewrite");
  if (found.length === 1) {
    const f = found[0];
    let d: DateTime | null;
    if (f.year) {
      const y = f.year.length === 2 ? 2000 + Number(f.year) : Number(f.year);
      d = DateTime.utc(y, f.month, f.day);
      if (!d.isValid) d = null;
    } else {
      const anchor = inputs.term_start ?? inputs.photo_date ?? inputs.added_date;
      if (!anchor) return fail(`"${text}" has no year`, "term_start");
      d = inferYear(f.month, f.day, anchor);
    }
    if (!d) return fail(`"${text}" isn't a real date`, "rewrite");
    if (weekday && d.weekday !== weekday) {
      const alt = nearestWithWeekday(d, weekday);
      return fail(
        `${d.toFormat("MMM d, yyyy")} is a ${WEEKDAY_NAMES[d.weekday]}, not a ${WEEKDAY_NAMES[weekday]}`,
        "choice",
        [iso(d), iso(alt)],
      );
    }
    return { ok: true, date: iso(d), rule: f.rule };
  }

  // Relative words only mean something next to the day the photo was taken.
  const relative = /\b(today|tonight|tomorrow|tmrw|tmr)\b/.exec(t);
  if (relative) {
    if (!inputs.photo_date) return fail(`"${text}" needs the day the photo was taken`, "photo_date");
    const offset = relative[1] === "today" || relative[1] === "tonight" ? 0 : 1;
    return { ok: true, date: iso(day(inputs.photo_date).plus({ days: offset })), rule: "relative_day" };
  }

  if (weekday) {
    if (!inputs.photo_date) return fail(`"${text}" needs a date or a week number`, "photo_date");
    const ref = day(inputs.photo_date);
    const ahead = (weekday - ref.weekday + 7) % 7;
    const first = ref.plus({ days: ahead === 0 ? 7 : ahead });
    // "Mon" written on a Monday, or "next Mon", could mean either of two Mondays.
    if (ahead === 0)
      return fail(`"${text}" was written on a ${WEEKDAY_NAMES[weekday]}`, "choice", [iso(first), iso(ref)]);
    if (/\bnext\b/.test(t))
      return fail(`"${text}" could be this coming one or the one after`, "choice", [
        iso(first),
        iso(first.plus({ weeks: 1 })),
      ]);
    return { ok: true, date: iso(first), rule: "weekday_after" };
  }

  return fail(`"${text}" isn't a date I can read`, "rewrite");
}

export type RangeResult =
  | { ok: true; start: string; end: string; rule: DateRule }
  | { ok: false; reason: string; needs: Extract<DateResult, { ok: false }>["needs"] };

const RANGE_SEP = /\s*(?:\s[-–—]\s|[–—]|(?<=\d)-(?=\s*[a-z\d])|\bto\b|\bthrough\b|\bthru\b|\buntil\b)\s*/i;

/**
 * A break as written: "Nov 25-29", "November 25 - November 29, 2026", "11/25-11/29", "Wed Nov 25", resolved to its
 * first and last day. The end takes the start's month when it's only a day ("25-29"). At most five weeks long.
 */
export function parseDateRange(text: string, inputs: DateInputs): RangeResult {
  const parts = text.trim().split(RANGE_SEP);
  const [a, b] = parts.length === 2 ? parts : [text, null];
  if (parts.length > 2) return { ok: false, reason: `"${text}" has more than one range in it`, needs: "rewrite" };
  // "November 25 - 29, 2026": the year written at the end belongs to both.
  const year = b ? /\b(\d{4})\s*$/.exec(b)?.[1] : undefined;
  const start = resolveDate(year && !/\b\d{4}\b/.test(a) ? `${a} ${year}` : a, inputs);
  if (!start.ok) return { ok: false, reason: start.reason, needs: start.needs };
  if (!b) return { ok: true, start: start.date, end: start.date, rule: start.rule };
  const bare = /^(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*\d{4})?$/.exec(b.trim());
  const end = bare
    ? resolveDate(`${day(start.date).toFormat("LLL")} ${bare[1]}${year ? ` ${year}` : ""}`, { ...inputs, term_start: start.date }) // prettier-ignore
    : resolveDate(b, { ...inputs, term_start: inputs.term_start ?? start.date });
  if (!end.ok) return { ok: false, reason: end.reason, needs: end.needs };
  const span = day(end.date).diff(day(start.date), "days").days;
  if (span < 0) return { ok: false, reason: `"${text}" ends before it starts`, needs: "rewrite" };
  if (span > 35) return { ok: false, reason: `"${text}" is longer than a break`, needs: "rewrite" };
  return { ok: true, start: start.date, end: end.date, rule: start.rule };
}

/** Every date from `start` to `end` (inclusive) that falls on one of `days`. */
export function meetingsBetween(days: Weekday[], start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = day(start); d <= day(end); d = d.plus({ days: 1 }))
    if (days.includes(d.weekday as Weekday)) out.push(iso(d));
  return out;
}

export type TimeResult =
  | { ok: true; kind: "clock"; start: string; end: string | null }
  /** "in class": the time is the course's class meeting that day, which the caller looks up. */
  | { ok: true; kind: "in_class"; meeting: "lecture" | "discussion" | "lab" | null }
  | { ok: false; reason: string };

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const CLOCK = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`;

/** Parses a time or time range as written. 24-hour times are fine; "5" alone isn't (am or pm?). */
export function parseTime(text: string): TimeResult {
  const t = text
    .toLowerCase()
    .replace(/\b([ap])\.?\s?m\b\.?/g, "$1m")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const inClass = /\bin (class|lecture|lec|discussion|dis|lab|section)\b/.exec(t);
  if (inClass) {
    const w = inClass[1];
    const meeting = w.startsWith("lec")
      ? "lecture"
      : w.startsWith("dis") || w === "section"
        ? "discussion"
        : w === "lab"
          ? "lab"
          : null;
    return { ok: true, kind: "in_class", meeting };
  }
  if (/\bnoon\b/.test(t)) return { ok: true, kind: "clock", start: "12:00", end: null };
  // A deadline at midnight means the end of that day.
  if (/\bmidnight\b/.test(t)) return { ok: true, kind: "clock", start: "23:59", end: null };

  const m = new RegExp(`\\b${CLOCK}(?:\\s*(?:-|to)\\s*${CLOCK})?\\b`).exec(t);
  if (!m) return { ok: false, reason: `"${text}" isn't a time I can read` };
  const toMinutes = (h: string, min: string | undefined, mer: string | undefined): number | null => {
    let hour = Number(h);
    const mins = min ? Number(min) : 0;
    if (mins > 59) return null;
    if (mer) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (mer === "pm" ? 12 : 0);
    } else if (hour > 23) return null;
    return hour * 60 + mins;
  };
  const [, h1, m1, mer1, h2, m2, mer2] = m;
  const is24h = (h: string, min?: string) => Number(h) >= 13 || (Number(h) === 0 && min !== undefined);

  if (!h2) {
    if (!mer1 && !is24h(h1, m1)) return { ok: false, reason: `"${text}" doesn't say am or pm` };
    const s = toMinutes(h1, m1, mer1);
    return s === null
      ? { ok: false, reason: `"${text}" isn't a real time` }
      : { ok: true, kind: "clock", start: hhmm(s), end: null };
  }
  // In "1:00-2:15pm" the first time takes the second's am/pm, unless that would put it after the end ("11-12:15pm").
  const endM = toMinutes(h2, m2, mer2);
  if (endM === null || (!mer2 && !is24h(h2, m2))) return { ok: false, reason: `"${text}" doesn't say am or pm` };
  let startM = toMinutes(h1, m1, mer1 ?? mer2);
  if (!mer1 && mer2 && startM !== null && startM > endM) startM = toMinutes(h1, m1, mer2 === "pm" ? "am" : "pm");
  if (startM === null) return { ok: false, reason: `"${text}" isn't a real time` };
  if (startM >= endM) return { ok: false, reason: `"${text}" ends before it starts` };
  return { ok: true, kind: "clock", start: hhmm(startM), end: hhmm(endM) };
}

/** A calendar date plus a wall-clock time in the person's zone, as an ISO instant with its offset. */
export function toInstant(date: string, time: string, zone: string): string {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!dt.isValid) throw new Error(`invalid instant ${date}T${time} in ${zone}`);
  return dt.toISO({ suppressMilliseconds: true })!;
}

/** The ISO date of an instant as the person sees it. */
export function localDate(instant: string, zone: string): string {
  return DateTime.fromISO(instant, { setZone: true }).setZone(zone).toISODate()!;
}

/** Parses Testudo-style meeting days ("MWF", "TuTh", "TTh", "Mon/Wed") into weekdays. */
export function parseDays(text: string): Weekday[] | null {
  const tokens: [string, Weekday][] = [
    ["monday", 1], ["tuesday", 2], ["wednesday", 3], ["thursday", 4], ["friday", 5], ["saturday", 6], ["sunday", 7],
    ["tues", 2], ["thurs", 4], ["mon", 1], ["tue", 2], ["wed", 3], ["thu", 4], ["fri", 5], ["sat", 6], ["sun", 7],
    ["th", 4], ["tu", 2], ["su", 7], ["sa", 6], ["m", 1], ["t", 2], ["w", 3], ["r", 4], ["f", 5],
  ]; // prettier-ignore
  let rest = text.toLowerCase().replace(/[^a-z]/g, "");
  if (!rest) return null;
  const out = new Set<Weekday>();
  while (rest) {
    const hit = tokens.find(([tok]) => rest.startsWith(tok));
    if (!hit) return null;
    out.add(hit[1]);
    rest = rest.slice(hit[0].length);
  }
  return [...out].sort();
}

const BYDAY = ["", "MO", "TU", "WE", "TH", "FR", "SA", "SU"];
/** Weekly on `days`; with `until` (a date, in `zone`), the last occurrence is on or before the end of that day. */
export function weeklyRrule(days: Weekday[], until?: { date: string; zone: string }): string {
  const rule = `FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(",")}`;
  if (!until) return rule;
  // RFC 5545: with a zoned DTSTART, UNTIL is in UTC.
  const end = DateTime.fromISO(until.date, { zone: until.zone }).endOf("day").toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  return `${rule};UNTIL=${end}`;
}

/** The first date on or after `from` that falls on one of `days`. */
export function firstMeeting(days: Weekday[], from: string): string {
  const d = day(from);
  const ahead = Math.min(...days.map((wd) => (wd - d.weekday + 7) % 7));
  return iso(d.plus({ days: ahead }));
}

/** The last date on or before `until` that falls on one of `days`. */
export function lastMeeting(days: Weekday[], until: string): string {
  const d = day(until);
  const back = Math.min(...days.map((wd) => (d.weekday - wd + 7) % 7));
  return iso(d.minus({ days: back }));
}

export function weekdayOf(isoDate: string): Weekday {
  return day(isoDate).weekday as Weekday;
}

export function minutesOf(hhmmText: string): number {
  const [h, m] = hhmmText.split(":").map(Number);
  return h * 60 + m;
}
