import { familyOf, itemKind, matchCourse, normalizeCode, type KnownCourse } from "@/lib/plan/courses";
import { contains, shortHash } from "@/lib/plan/text";
import {
  ok,
  type Candidate,
  type Check,
  type ClassBlock,
  type DateTrace,
  type PageReading,
  type SourceMeta,
  type SourceReading,
  type TermStart,
} from "@/lib/plan/types";
import { verifyReading, worst } from "@/lib/plan/verify";
import {
  firstMeeting,
  localDate,
  parseDays,
  parseTime,
  resolveDate,
  weeklyRrule,
  type DateInputs,
} from "@/lib/resolve/dates";
import { toEvidence } from "@/lib/schemas/evidence";
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

export function termStart(readings: SourceReading[], zone: string): TermStart {
  const found: TermStart[] = [];
  for (const { source, page, data } of syllabusPages(readings)) {
    const t = data.term_start;
    if (!t) continue;
    const evidence = toEvidence(t.evidence, source.id, page.page);
    const read = verifyReading(page, "term_start", t.evidence.quote, [t.date_text]);
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
    return { date: null, check: { status: "conflict", reason: "Two syllabi give different first days of classes." } };
  return (
    dated.find((f) => f.check.status === "verified") ??
    dated[0] ??
    found[0] ?? { date: null, check: { status: "needs_question", reason: "No source says when classes start." } }
  );
}

export function classBlocks(readings: SourceReading[], term: TermStart): ClassBlock[] {
  const out: ClassBlock[] = [];
  const seen = new Set<string>();
  for (const { source, page, data } of schedulePages(readings))
    data.classes.forEach((c, i) => {
      const course = normalizeCode(c.course_code) ?? c.course_code.toUpperCase();
      const grid = data.view === "grid";
      // On a grid, the quote's day names are column headers, not part of the block; the block's own lines are checked.
      const checked = grid
        ? c.evidence.quote
            .split("\n")
            .filter((l) => !parseDays(l))
            .join("\n")
        : c.evidence.quote;
      const read = verifyReading(page, `classes.${i}`, checked || c.evidence.quote, [
        grid ? null : c.days_text,
        c.start_text,
        c.end_text,
      ]);
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
      if (seen.has(key)) return; // the same meeting from a second schedule source
      seen.add(key);
      const evidence = toEvidence(c.evidence, source.id, page.page);
      const ds = days ?? [];
      const firstTrace = (from: string): DateTrace => ({
        text: c.days_text,
        evidence,
        rule: "first_meeting",
        inputs: { term_start: from, photo_date: null, added_date: null },
      });
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
        rrule: weeklyRrule(ds),
        first_date:
          term.date && ds.length
            ? { value: firstMeeting(ds, term.date.value), trace: firstTrace(term.date.value) }
            : null,
        evidence,
        checks,
        status: worst(checks.quote, checks.days, checks.time).status,
      });
    });
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
          evidence: toEvidence(it.evidence, source.id, page.page),
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
          evidence: toEvidence(it.evidence, source.id, page.page),
        },
      });
    });
  return out;
}

const needs = (reason: string): Check => ({ status: "needs_question", reason });

export function candidates(readings: SourceReading[], term: TermStart, zone: string): Candidate[] {
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
    const { family, number } = titled.family ? titled : familyOf(raw.quote);

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
      time_text: raw.time_text,
      evidence: raw.evidence,
      checks: { quote: read.quote, title: titleCheck, course: raw.course.check, date: dateCheck, time: timeCheck },
      date_needs: dateNeeds,
      legibility: { reread: read.reread, unsure: raw.unsure },
    };
  });
}
