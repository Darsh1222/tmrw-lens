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
  pagesOf<WhiteboardExtraction | NotesExtraction>(r, ["whiteboard_photo", "notes_photo"]);

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
  for (const e of all) {
    const k = [normalizeCode(e.c.course_code), e.c.meeting_type, e.c.start_text, e.c.end_text, e.c.location].join("|");
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
    const c: Meeting = {
      ...g[0].c,
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
      const start = parseTime(c.start_text);
      const end = parseTime(c.end_text);
      const startT = start.ok && start.kind === "clock" ? start.start : null;
      const endT = end.ok && end.kind === "clock" ? end.start : null;
      // On a grid, days come from which column a block sits in: no quote can prove that, so the person confirms.
      const daysCheck: Check = !days
        ? { status: "unverified", reason: `Can't read "${c.days_text}".` }
        : grid && contains(c.evidence.quote, c.days_text)
          ? { status: "needs_question", reason: GRID_DAYS }
          : read.fields[0];
      const timeCheck: Check =
        startT && endT && startT < endT
          ? worst(read.fields[1], read.fields[2])
          : { status: "unverified", reason: `Can't read "${c.start_text} - ${c.end_text}".` };
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
