import { familyOf, itemKind, matchCourse, normalizeCode, type KnownCourse } from "@/lib/plan/courses";
import { contains, shortHash } from "@/lib/plan/text";
import {
  ok,
  type Candidate,
  type Check,
  type ClassBlock,
  type DateTrace,
  type Facts,
  type PageReading,
  type SourceMeta,
  type SourceReading,
  type TermBreak,
  type TermBreaks,
  type TermDate,
  type TracedDate,
} from "@/lib/plan/types";
import { verifyReading, worst } from "@/lib/plan/verify";
import {
  firstMeeting,
  lastMeeting,
  localDate,
  meetingsBetween,
  parseDateRange,
  parseDays,
  parseTime,
  resolveDate,
  weeklyRrule,
  type DateInputs,
} from "@/lib/resolve/dates";
import { objectFor, regionOf } from "@/lib/plan/objects";
import { toEvidence, type Evidence, type ModelEvidence } from "@/lib/schemas/evidence";
import type {
  NotesExtraction,
  ScheduleExtraction,
  SyllabusPageExtraction,
  WhiteboardExtraction,
} from "@/lib/schemas/extraction";

// From readings to checked pieces: the term start, class blocks, and one
// candidate per item per source. Each field is resolved in code and gets its own
// check; nothing here compares sources (that's merge.ts).

export const GRID_DAYS = "Read from which columns the class sits in on the grid.";
export const GRID_TIMES =
  "Worked out from where the block sits against the grid's time axis, to the nearest 5 minutes.";

type AxisLabel = ScheduleExtraction["time_axis"][number];
type Box = NonNullable<ScheduleExtraction["classes"][number]["block"]>;

/**
 * A grid block's times from where it sits: a straight line through the hour labels down the time axis (each label's
 * middle is its hour line), read at the block's top and bottom edges, rounded to 5 minutes. A label more than 12
 * minutes off the line the others make was misplaced, and is left out. Null when the axis has
 * fewer than two readable labels, or the answer isn't a plausible class (outside 6 AM to midnight, under 15 minutes,
 * over 5 hours).
 */
export function gridTimes(axis: AxisLabel[], block: Box | null): { start: string; end: string } | null {
  if (!block) return null;
  const points = axis.flatMap((l) => {
    const t = parseTime(l.label_text);
    if (!t.ok || t.kind !== "clock" || !l.evidence.box) return [];
    const [h, m] = t.start.split(":").map(Number);
    return [{ y: (l.evidence.box.y_min + l.evidence.box.y_max) / 2, hours: h + m / 60 }];
  });
  const fit = (ps: typeof points) => {
    const my = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    const mh = ps.reduce((a, p) => a + p.hours, 0) / ps.length;
    const slope = ps.reduce((a, p) => a + (p.y - my) * (p.hours - mh), 0) / ps.reduce((a, p) => a + (p.y - my) ** 2, 0);
    return { my, mh, slope, off: (p: (typeof ps)[number]) => Math.abs(mh + (p.y - my) * slope - p.hours) };
  };
  let used = points;
  for (;;) {
    if (new Set(used.map((p) => p.hours)).size < 2) return null;
    const f = fit(used);
    const worst = used.reduce((a, p) => (f.off(p) > f.off(a) ? p : a));
    if (used.length <= 3 || f.off(worst) <= 0.2) break;
    used = used.filter((p) => p !== worst);
  }
  const { my, mh, slope } = fit(used);
  if (!Number.isFinite(slope) || slope <= 0) return null;
  const at = (y: number) => Math.round(((mh + (y - my) * slope) * 60) / 5) * 5;
  const [start, end] = [at(block.y_min), at(block.y_max)];
  if (start < 6 * 60 || end > 24 * 60 || end - start < 15 || end - start > 300) return null;
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { start: hhmm(start), end: hhmm(end) };
}

type Page<T> = { source: SourceMeta; page: PageReading; data: T };

/** Where a quote was read, plus the SAM object (sticky note, sheet, board) it sits in, when there is one. */
function evidenceOf(model: ModelEvidence, source: SourceMeta, page: PageReading): Evidence {
  const e = toEvidence(model, source.id, page.page);
  const object = objectFor(e.bbox, page.objects);
  return object ? { ...e, region: regionOf(object) } : e;
}

function pagesOf<T>(readings: SourceReading[], kinds: SourceMeta["kind"][]): Page<T>[] {
  return readings
    .filter((r) => kinds.includes(r.source.kind))
    .flatMap((r) => r.pages.map((page) => ({ source: r.source, page, data: page.extraction as T })));
}

export const schedulePages = (r: SourceReading[]) =>
  pagesOf<ScheduleExtraction>(r, ["testudo_screenshot", "testudo_text"]);
export const syllabusPages = (r: SourceReading[]) => pagesOf<SyllabusPageExtraction>(r, ["syllabus_pdf"]);
const freeformPages = (r: SourceReading[]) =>
  pagesOf<WhiteboardExtraction | NotesExtraction>(r, ["whiteboard_photo", "notes_photo", "lms_screenshot"]);

export function knownCourses(readings: SourceReading[]): KnownCourse[] {
  const out = new Map<string, KnownCourse>();
  for (const { data } of schedulePages(readings))
    for (const c of data.classes) {
      const code = normalizeCode(c.course_code);
      if (code && !out.get(code)?.title) out.set(code, { code, title: c.title });
    }
  for (const { data } of syllabusPages(readings)) {
    const code = data.course_code ? normalizeCode(data.course_code) : null;
    if (code && !out.get(code)?.title) out.set(code, { code, title: data.course_title });
  }
  return [...out.values()];
}

/** The first or last day of classes, from whichever syllabus or schedule says it. Two that disagree are a conflict. */
export function termDate(readings: SourceReading[], zone: string, key: "term_start" | "term_end"): TermDate {
  const which = key === "term_start" ? "first" : "last";
  const found: TermDate[] = [];
  const pages = [...syllabusPages(readings), ...schedulePages(readings)];
  for (const { source, page, data } of pages) {
    const t = key in data ? (data as Record<typeof key, SyllabusPageExtraction["term_start"]>)[key] : null;
    if (!t) continue;
    const evidence = evidenceOf(t.evidence, source, page);
    const read = verifyReading(page, key, t.evidence.quote, [t.date_text]);
    const inputs: DateInputs = { term_start: null, photo_date: null, added_date: localDate(source.added_at, zone) };
    const r = resolveDate(t.date_text, inputs);
    if (!r.ok) {
      found.push({ date: null, check: { status: "needs_question", reason: r.reason } });
      continue;
    }
    found.push({
      date: { value: r.date, trace: { text: t.date_text, evidence, rule: r.rule, inputs } },
      check: worst(read.quote, ...read.fields),
    });
  }
  const dated = found.filter((f) => f.date);
  const values = new Set(dated.map((f) => f.date!.value));
  if (values.size > 1)
    return {
      date: null,
      check: { status: "conflict", reason: `Two sources give different ${which} days of classes.` },
    };
  return (
    dated.find((f) => f.check.status === "verified") ??
    dated[0] ??
    found[0] ?? {
      date: null,
      check: { status: "needs_question", reason: `No source says the ${which} day of classes.` },
    }
  );
}

export const termStart = (readings: SourceReading[], zone: string) => termDate(readings, zone, "term_start");

/** What the person said, as evidence: there's no page to point at, only their answer. */
export function answerEvidence(question: string, words: string): Evidence {
  return { source_id: "answer", page: null, bbox: null, quote: words || question };
}

/** A date the person gave, traced to the question they answered. */
export function answeredDate(date: string, question: string, words = date): TracedDate {
  return {
    value: date,
    trace: {
      text: words,
      evidence: answerEvidence(question, words),
      rule: "answer",
      inputs: { term_start: null, photo_date: null, added_date: null, answer: question },
    },
  };
}

/** Breaks with no classes, from every syllabus and schedule that lists them, or from the person's answer. */
export function termBreaks(readings: SourceReading[], term: TermDate, zone: string, facts: Facts = {}): TermBreaks {
  if (facts.breaks) {
    const breaks = facts.breaks.map((b, i) => ({
      id: `break_${shortHash(`${b.start}|${b.end}|${i}`)}`,
      name: b.name,
      start: b.start,
      end: b.end,
      trace: { ...answeredDate(b.start, b.question, b.text).trace },
    }));
    return { breaks, check: { status: "verified", reason: breaks.length ? null : "You said there are no breaks." } };
  }
  const out = new Map<string, TermBreak>();
  let unread: Check | null = null;
  for (const { source, page, data } of [...syllabusPages(readings), ...schedulePages(readings)])
    for (const [i, b] of (data.breaks ?? []).entries()) {
      const inputs: DateInputs = {
        term_start: term.date?.value ?? null,
        photo_date: null,
        added_date: localDate(source.added_at, zone),
      };
      const read = verifyReading(page, `breaks.${i}`, b.evidence.quote, [b.dates_text]);
      const r = parseDateRange(b.dates_text, inputs);
      const check = worst(read.quote, ...read.fields);
      if (!r.ok || check.status !== "verified") {
        unread = r.ok ? check : { status: "needs_question", reason: r.reason };
        continue;
      }
      const key = `${r.start}|${r.end}`;
      if (out.has(key)) continue; // the same break in two syllabi
      out.set(key, {
        id: `break_${shortHash(key)}`,
        name: b.name,
        start: r.start,
        end: r.end,
        trace: { text: b.dates_text, evidence: evidenceOf(b.evidence, source, page), rule: r.rule, inputs },
      });
    }
  const breaks = [...out.values()].sort((a, b) => a.start.localeCompare(b.start));
  if (breaks.length) return { breaks, check: ok };
  return { breaks, check: unread ?? { status: "needs_question", reason: "No source lists the breaks." } };
}

type Meeting = ScheduleExtraction["classes"][number];

/**
 * One entry per meeting pattern. A grid can be read one block per column ("Monday" MATH141 10:00, "Wednesday" MATH141
 * 10:00, ...): those become one class meeting on every day it appears, with every block's quote as its evidence and
 * the union of their boxes as its highlight. List and text views are already one entry per pattern.
 */
function gridMeetings(data: ScheduleExtraction): { c: Meeting; members: { i: number; quote: string }[] }[] {
  const all = data.classes.map((c, i) => ({ c, members: [{ i, quote: c.evidence.quote }] }));
  if (data.view !== "grid") return all;
  const groups = new Map<string, typeof all>();
  // Blocks without written times group by the times their position gives, within 10 minutes: the same class
  // measured a pixel apart in two columns can round to neighbouring 5 minutes.
  const placedOf = (c: Meeting) => (c.start_text && c.end_text ? null : gridTimes(data.time_axis ?? [], c.block ?? null)); // prettier-ignore
  const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  const close = (a: { start: string; end: string }, b: { start: string; end: string }) =>
    Math.abs(mins(a.start) - mins(b.start)) <= 10 && Math.abs(mins(a.end) - mins(b.end)) <= 10;
  for (const e of all) {
    const placed = placedOf(e.c);
    const base = [normalizeCode(e.c.course_code), e.c.meeting_type, e.c.location].join("|");
    const near = placed
      ? [...groups.keys()].find((k) => {
          const first = groups.get(k)![0].c;
          const other = placedOf(first);
          return k.startsWith(`${base}|placed|`) && other && close(placed, other);
        })
      : undefined;
    const k = near ?? (placed ? `${base}|placed|${placed.start}|${placed.end}` : `${base}|${e.c.start_text}|${e.c.end_text}`); // prettier-ignore
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    const boxes = g.flatMap((e) => (e.c.evidence.box ? [e.c.evidence.box] : []));
    const box = boxes.length
      ? {
          x_min: Math.min(...boxes.map((b) => b.x_min)),
          y_min: Math.min(...boxes.map((b) => b.y_min)),
          x_max: Math.max(...boxes.map((b) => b.x_max)),
          y_max: Math.max(...boxes.map((b) => b.y_max)),
        }
      : null;
    // Every block in a group sits at the same height: the most common measurement stands for them all.
    const blocks = g.flatMap((e) => (e.c.block ? [e.c.block] : []));
    const common = (key: "y_min" | "y_max") => {
      const counts = new Map<number, number>();
      for (const b of blocks) counts.set(b[key], (counts.get(b[key]) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    };
    const c: Meeting = {
      ...g[0].c,
      block: blocks.length ? { ...blocks[0], y_min: common("y_min")!, y_max: common("y_max")! } : null,
      days_text: [...new Set(g.map((e) => e.c.days_text))].join(" "),
      evidence: { quote: g.map((e) => e.c.evidence.quote).join("\n"), box },
    };
    return { c, members: g.flatMap((e) => e.members) };
  });
}

/** Meetings that fall in a break, within the term when its first and last days are known. */
export function skipDates(days: ClassBlock["days"], breaks: TermBreak[], from: string | null, until: string | null) {
  return breaks.flatMap((b) =>
    meetingsBetween(days, b.start, b.end)
      .filter((d) => (!from || d >= from) && (!until || d <= until))
      .map((date) => ({ date, break_id: b.id })),
  );
}

export function classBlocks(
  readings: SourceReading[],
  term: TermDate,
  { termEnd, zone, breaks = [] }: { termEnd: TermDate; zone: string; breaks?: TermBreak[] },
): ClassBlock[] {
  const out: ClassBlock[] = [];
  const seen = new Set<string>();
  for (const { source, page, data } of schedulePages(readings))
    for (const { c, members } of gridMeetings(data)) {
      const course = normalizeCode(c.course_code) ?? c.course_code.toUpperCase();
      const grid = data.view === "grid";
      // On a grid, the quote's day names are column headers, not part of the block; the block's own lines are checked.
      const checkedOf = (quote: string) =>
        grid
          ? quote
              .split("\n")
              .filter((l) => !parseDays(l))
              .join("\n") || quote
          : quote;
      const reads = members.map(({ i, quote }) =>
        verifyReading(page, `classes.${i}`, checkedOf(quote), [grid ? null : c.days_text, c.start_text, c.end_text]),
      );
      const read = {
        quote: worst(...reads.map((r) => r.quote)),
        fields: [0, 1, 2].map((k) => worst(...reads.map((r) => r.fields[k]))),
      };
      const days = parseDays(c.days_text);
      const start = c.start_text ? parseTime(c.start_text) : null;
      const end = c.end_text ? parseTime(c.end_text) : null;
      // A grid block with no times written: from its position, unconfirmed until the person says so.
      const placed = grid && (!c.start_text || !c.end_text) ? gridTimes(data.time_axis ?? [], c.block ?? null) : null;
      const startT = placed?.start ?? (start?.ok && start.kind === "clock" ? start.start : null);
      const endT = placed?.end ?? (end?.ok && end.kind === "clock" ? end.start : null);
      // On a grid, days come from which column a block sits in: no quote can prove that, so the person confirms.
      const daysCheck: Check = !days
        ? { status: "unverified", reason: `Can't read "${c.days_text}".` }
        : grid && contains(c.evidence.quote, c.days_text)
          ? { status: "needs_question", reason: GRID_DAYS }
          : read.fields[0];
      const timeCheck: Check =
        startT && endT && startT < endT
          ? placed
            ? { status: "needs_question", reason: GRID_TIMES }
            : worst(read.fields[1], read.fields[2])
          : {
              status: "unverified",
              reason:
                c.start_text && c.end_text
                  ? `Can't read "${c.start_text} - ${c.end_text}".`
                  : "No times written on the block, and its place on the grid couldn't be read.",
            };
      const key = [course, c.meeting_type, days?.join(""), startT, endT].join("|");
      if (seen.has(key)) continue; // the same meeting from a second schedule source
      seen.add(key);
      const evidence = evidenceOf(c.evidence, source, page);
      const ds = days ?? [];
      const firstTrace = (from: string): DateTrace => ({
        text: c.days_text,
        evidence,
        rule: "first_meeting",
        inputs: { term_start: from, photo_date: null, added_date: null },
      });
      const until = termEnd.date?.value ?? null;
      const checks = { quote: read.quote, days: daysCheck, time: timeCheck };
      out.push({
        id: `class_${shortHash(key)}`,
        source,
        course,
        section: c.section,
        title: c.title,
        meeting_type: c.meeting_type,
        days: ds,
        start: startT ?? "00:00",
        end: endT ?? "00:00",
        location: c.location,
        rrule: weeklyRrule(ds, until ? { date: until, zone } : undefined),
        first_date:
          term.date && ds.length
            ? { value: firstMeeting(ds, term.date.value), trace: firstTrace(term.date.value) }
            : null,
        last_date:
          until && ds.length
            ? {
                value: lastMeeting(ds, until),
                trace: {
                  text: c.days_text,
                  evidence,
                  rule: "last_meeting",
                  inputs: { term_start: null, photo_date: null, added_date: null, term_end: until },
                },
              }
            : null,
        skip_dates: skipDates(ds, breaks, term.date?.value ?? null, until),
        evidence,
        checks,
        status: worst(checks.quote, checks.days, checks.time).status,
      });
    }
  return out;
}

type RawItem = {
  kind: string;
  title: string;
  course: { code: string | null; check: Check };
  date_text: string | null;
  time_text: string | null;
  change_text: string | null;
  crossed_out: boolean;
  unsure: boolean;
  quote: string;
  evidence: Candidate["evidence"];
};

function rawItems(readings: SourceReading[], known: KnownCourse[]) {
  const out: { source: SourceMeta; page: PageReading; key: string; raw: RawItem }[] = [];
  const bySource = new Map<string, string | null>();
  for (const { source, data } of syllabusPages(readings))
    if (data.course_code && !bySource.get(source.id)) bySource.set(source.id, normalizeCode(data.course_code));

  for (const { source, page, data } of syllabusPages(readings))
    data.items.forEach((it, i) => {
      const code = bySource.get(source.id) ?? null;
      out.push({
        source,
        page,
        key: `items.${i}`,
        raw: {
          kind: it.kind,
          title: it.title,
          course: {
            code,
            check: code ? ok : { status: "needs_question", reason: "The syllabus doesn't name its course." },
          },
          date_text: it.date_text,
          time_text: it.time_text,
          change_text: null,
          crossed_out: false,
          unsure: false,
          quote: it.evidence.quote,
          evidence: evidenceOf(it.evidence, source, page),
        },
      });
    });

  for (const { source, page, data } of freeformPages(readings))
    data.items.forEach((it, i) => {
      const m = matchCourse(it.course_hint, known);
      const check: Check =
        m.code || !it.course_hint
          ? ok
          : {
              status: "needs_question",
              reason: m.ambiguous.length
                ? `"${it.course_hint}" could be ${m.ambiguous.join(" or ")}.`
                : `"${it.course_hint}" isn't one of the courses I know.`,
            };
      out.push({
        source,
        page,
        key: `items.${i}`,
        raw: {
          kind: it.kind,
          title: it.title,
          course: { code: m.code, check },
          date_text: it.date_text,
          time_text: it.time_text,
          change_text: it.change_text,
          crossed_out: "crossed_out" in it && it.crossed_out === true,
          unsure: it.legible === "unsure",
          quote: it.evidence.quote,
          evidence: evidenceOf(it.evidence, source, page),
        },
      });
    });
  return out;
}

const needs = (reason: string): Check => ({ status: "needs_question", reason });

export function candidates(readings: SourceReading[], term: TermDate, zone: string): Candidate[] {
  const known = knownCourses(readings);
  return rawItems(readings, known).map(({ source, page, key, raw }) => {
    const read = verifyReading(
      page,
      key,
      raw.quote,
      [raw.title, raw.date_text, raw.time_text, raw.change_text],
      raw.unsure,
    );
    const [titleCheck, dateRead, timeRead, changeRead] = read.fields;
    const kind = itemKind(raw.kind);
    // "improper integrals" says nothing, but its quote "Quiz Fri: improper integrals" does.
    const titled = familyOf(raw.title);
    // The quote's date words aren't the item: "review slides before Exam 2" isn't Exam 2.
    const { family, number } = titled.family
      ? titled
      : familyOf(raw.date_text ? raw.quote.replace(raw.date_text, " ") : raw.quote);

    const inputs: DateInputs = {
      term_start: term.date?.value ?? null,
      photo_date: source.captured_at ? localDate(source.captured_at, zone) : null,
      added_date: localDate(source.added_at, zone),
    };
    let date: Candidate["date"] = null;
    let dateCheck: Check = ok;
    let dateNeeds: Candidate["date_needs"] = null;
    if (raw.date_text === null) {
      if (kind !== "task") dateCheck = needs("No date is written next to it.");
    } else if (dateRead.status !== "verified") {
      dateCheck = dateRead;
    } else {
      const r = resolveDate(raw.date_text, inputs);
      if (r.ok) {
        date = { value: r.date, trace: { text: raw.date_text, evidence: raw.evidence, rule: r.rule, inputs } };
      } else {
        dateCheck = needs(r.reason);
        dateNeeds = { needs: r.needs, options: r.options };
      }
    }

    let time: Candidate["time"] = null;
    let timeCheck: Check = ok;
    if (raw.time_text !== null) {
      if (timeRead.status !== "verified") timeCheck = timeRead;
      else {
        const t = parseTime(raw.time_text);
        if (!t.ok) timeCheck = needs(t.reason);
        else if (t.kind === "clock")
          time = {
            start: t.start,
            end: t.end,
            trace: { text: raw.time_text, evidence: raw.evidence, rule: "clock", class_id: null },
          };
        // "in class" is filled in from the schedule once class blocks are known.
        else timeCheck = needs("It says it's in class.");
      }
    }

    return {
      id: `${source.id}:${page.page ?? 0}:${key}`,
      source,
      kind,
      family,
      number,
      title: raw.title,
      course: raw.course.code,
      change_text: changeRead.status === "verified" ? raw.change_text : null,
      crossed_out: raw.crossed_out,
      date,
      time,
      date_text: raw.date_text,
      time_text: raw.time_text,
      evidence: raw.evidence,
      checks: { quote: read.quote, title: titleCheck, course: raw.course.check, date: dateCheck, time: timeCheck },
      date_needs: dateNeeds,
      legibility: { reread: read.reread, unsure: raw.unsure },
    };
  });
}
