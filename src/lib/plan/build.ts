import { DateTime } from "luxon";
import {
  answeredDate,
  candidates,
  classBlocks,
  GRID_DAYS,
  GRID_TIMES,
  skipDates,
  syllabusNotes,
  termBreaks,
  termDate,
  type SyllabusNotes,
} from "@/lib/plan/candidates";
import { linkDependents, propagate } from "@/lib/plan/depends";
import { formatTime, merge } from "@/lib/plan/merge";
import { ok as verified } from "@/lib/plan/types";
import type {
  Candidate,
  ClassBlock,
  CourseInfo,
  Facts,
  Plan,
  PlanItem,
  Question,
  SourceReading,
  TermDate,
} from "@/lib/plan/types";
import { worst } from "@/lib/plan/verify";
import {
  firstMeeting,
  formatDate,
  lastMeeting,
  minutesOf,
  parseDays,
  parseNotice,
  parseTime,
  WEEKDAY_NAMES,
  weekdayOf,
  weeklyRrule,
} from "@/lib/resolve/dates";

// Everything after the model: readings in, a plan with statuses and questions
// out. Pure code, so it runs the same in the app, in tests, and in evals on
// recorded readings.

/**
 * A syllabus exam its page says is "in-class": the course's lecture that day, from the schedule if there is one, else
 * from the syllabus's own lecture line. Never a guess: no lecture that day leaves the time a question.
 */
function inClassExam(c: Candidate, classes: ClassBlock[]): Candidate {
  const n = c.in_class;
  if (!n || c.time || !c.date) return c;
  const wd = weekdayOf(c.date.value);
  const blocks = classes.filter((b) => b.course === c.course && b.days.includes(wd) && b.meeting_type === "lecture");
  if (blocks.length === 1) {
    const b = blocks[0];
    return {
      ...c,
      time: { start: b.start, end: b.end, trace: { text: n.text, evidence: n.evidence, rule: "in_class", class_id: b.id } }, // prettier-ignore
      checks: { ...c.checks, time: b.status === "verified" ? { status: "verified", reason: null } : { status: "needs_question", reason: `The ${b.course} class time isn't confirmed yet.` } }, // prettier-ignore
    };
  }
  const lines = n.lectures.filter((l) => parseDays(l.days_text)?.includes(wd));
  const t = lines.length === 1 ? parseTime(lines[0].time_text) : null;
  if (!t?.ok || t.kind !== "clock" || !t.end) {
    const reason = `It's "${n.text}", but ${lines.length > 1 ? "more than one" : "no"} ${c.course ?? ""} lecture is listed for ${WEEKDAY_NAMES[wd]}.`.replace("  ", " "); // prettier-ignore
    return { ...c, checks: { ...c.checks, time: { status: "needs_question", reason } } };
  }
  const l = lines[0];
  return {
    ...c,
    time: {
      start: t.start,
      end: t.end,
      trace: { text: n.text, evidence: n.evidence, rule: "in_class", class_id: null, lecture: { days_text: l.days_text, time_text: l.time_text, evidence: l.evidence } }, // prettier-ignore
    },
    checks: { ...c.checks, time: { status: "verified", reason: null } },
  };
}

/** "in class" becomes the course's meeting that day, from the schedule. */
function fillInClass(c: Candidate, classes: ClassBlock[]): Candidate {
  if (c.in_class) return inClassExam(c, classes);
  if (!c.time_text || c.time || !c.date || c.checks.time.status !== "needs_question") return c;
  const parsed = parseTime(c.time_text);
  if (!parsed.ok || parsed.kind !== "in_class") return c;
  const meeting = parsed.meeting;
  const wd = weekdayOf(c.date.value);
  let blocks = classes.filter((b) => b.course === c.course && b.days.includes(wd));
  if (meeting) blocks = blocks.filter((b) => b.meeting_type === meeting);
  if (blocks.length > 1) blocks = blocks.filter((b) => b.meeting_type === "lecture");
  if (blocks.length !== 1) {
    const reason = classes.some((b) => b.course === c.course)
      ? `No ${c.course} class meets on ${WEEKDAY_NAMES[wd]}.`
      : "It says it's in class. Add your class schedule, or tell me the time.";
    return { ...c, checks: { ...c.checks, time: { status: "needs_question", reason } } };
  }
  const b = blocks[0];
  return {
    ...c,
    time: {
      start: b.start,
      end: b.end,
      trace: { text: c.time_text, evidence: c.evidence, rule: "in_class", class_id: b.id },
    },
    checks: {
      ...c.checks,
      time:
        b.status === "verified"
          ? { status: "verified", reason: null }
          : { status: "needs_question", reason: `The ${b.course} class time isn't confirmed yet.` },
    },
  };
}

/** A timed item that sits on top of a class (of another course) is worth one question. */
function overlap(item: PlanItem, classes: ClassBlock[]): ClassBlock | null {
  if (!item.date || !item.time?.end || item.kind === "task") return null;
  const wd = weekdayOf(item.date.value);
  const s = minutesOf(item.time.start);
  const e = minutesOf(item.time.end);
  return (
    classes.find(
      (b) =>
        b.course !== item.course &&
        b.days.includes(wd) &&
        (!b.first_date || b.first_date.value <= item.date!.value) &&
        s < minutesOf(b.end) &&
        minutesOf(b.start) < e,
    ) ?? null
  );
}

const MEETING = { lecture: "lecture", discussion: "discussion", lab: "lab", other: "class" };

/** The readings with the photo dates the person gave: "Mon" on that photo then resolves like any dated photo's. */
export function withFacts(readings: SourceReading[], facts: Facts, zone: string): SourceReading[] {
  const dates = facts.photo_dates ?? {};
  return readings.map((r) =>
    dates[r.source.id]
      ? {
          ...r,
          source: {
            ...r.source,
            captured_at: DateTime.fromISO(dates[r.source.id].date, { zone }).set({ hour: 12 }).toISO()!,
          },
        }
      : r,
  );
}

const told = (f: { date: string; question: string } | undefined): TermDate | null =>
  f ? { date: answeredDate(f.date, f.question), check: { status: "verified", reason: "You said so." } } : null;

/** `facts` are what the person has answered that changes how things resolve; see `planFrom` in session.ts. */
export function buildPlan(input: SourceReading[], { zone, facts = {} }: { zone: string; facts?: Facts }): Plan {
  const readings = withFacts(input, facts, zone);
  const term = told(facts.term_start) ?? termDate(readings, zone, "term_start");
  const termEnd = told(facts.term_end) ?? termDate(readings, zone, "term_end");
  const breaks = termBreaks(readings, term, zone, facts);
  const notes = syllabusNotes(readings);
  const classes = [
    ...classBlocks(readings, term, { termEnd, zone, breaks: breaks.breaks }),
    ...officeHours(notes, facts, term, termEnd, zone, breaks.breaks),
  ];
  markQuizDays(classes, notes, facts);
  const all = candidates(readings, term, zone).map((c) => fillInClass(c, classes));
  const live = all.filter((c) => !c.crossed_out);
  const { items, questions } = merge(live, { separate: facts.separate });
  const byId = new Map(all.map((c) => [c.id, c]));
  const asked: Question[] = linkDependents(items, byId);
  items.push(...noticeItems(items, byId, notes));
  propagate(items);

  // The first day of classes is one question for the whole plan, not one per item.
  const needsTerm =
    classes.length > 0 || live.some((c) => c.date_needs?.needs === "term_start") || term.check.status === "conflict";
  if (!term.date && needsTerm)
    asked.push({
      id: "q_term_start",
      about: "term",
      type: "missing_fact",
      prompt: "When is the first day of classes?",
      options: [{ id: "edit", label: "Pick the date", value: null, evidence: null }],
      input: "date",
      suggested: null,
      why_suggested: null,
    });

  // Weekly classes repeat until the last day of classes: one question if no syllabus or schedule says when that is.
  if (classes.length > 0 && !termEnd.date)
    asked.push({
      id: "q_term_end",
      about: "term",
      type: "missing_fact",
      prompt: `When is the last day of classes? Your weekly classes repeat until then.${termEnd.check.status === "conflict" ? ` ${termEnd.check.reason}` : ""}`,
      options: [{ id: "edit", label: "Pick the date", value: null, evidence: null }],
      input: "date",
      suggested: null,
      why_suggested: null,
    });

  // A photo with no date can't place "Mon" or "tomorrow": one question per photo.
  const undatedPhotos = new Set(live.filter((c) => c.date_needs?.needs === "photo_date").map((c) => c.source.id));
  for (const sourceId of undatedPhotos) {
    const src = live.find((c) => c.source.id === sourceId)!.source;
    asked.push({
      id: `q_photo_date_${sourceId}`,
      about: sourceId,
      type: "missing_fact",
      prompt: `When was the ${src.label} taken? It says things like "Mon", which depend on that.`,
      options: [{ id: "edit", label: "Pick the date", value: null, evidence: null }],
      input: "date",
      suggested: null,
      why_suggested: null,
    });
  }

  // Class days (and times, where a block shows none) read off a grid: one question per screenshot, not one per class.
  const fromGrid = (c: ClassBlock) => c.checks.days.reason === GRID_DAYS || c.checks.time.reason === GRID_TIMES;
  const gridSources = new Set(classes.filter(fromGrid).map((c) => c.source.id));
  for (const sourceId of gridSources) {
    // A class a popup partly covers gets its own question (below), not a line here.
    const read = classes.filter((c) => c.source.id === sourceId && c.checks.time.status !== "unverified");
    const placed = read.some((c) => c.checks.time.reason === GRID_TIMES);
    const what = placed
      ? "which days each class meets from the columns, and its times from where it sits against the time axis,"
      : "which days each class meets from the columns";
    asked.push({
      id: `q_grid_days_${sourceId}`,
      about: sourceId,
      type: "check",
      prompt: `I read ${what} of the ${read[0].source.label}. Are these right? ${read.map((c) => `${c.course} ${MEETING[c.meeting_type]}: ${c.days.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(" ")}${placed ? ` ${formatTime(c.start)}-${formatTime(c.end)}` : ""}`).join("; ")}.`, // prettier-ignore
      options: [
        { id: "confirm", label: "Yes, they're right", value: "confirm", evidence: null },
        { id: "edit", label: "Let me fix them", value: null, evidence: null },
      ],
      input: "fields",
      suggested: null,
      why_suggested: null,
    });
  }
  for (const c of classes)
    if (c.status === "unverified") {
      const reason = [c.checks.quote, c.checks.days, c.checks.time].find((k) => k.status === "unverified")!.reason;
      asked.push({
        id: `q_${c.id}_check`,
        about: c.id,
        type: "check",
        prompt: `I couldn't confirm ${c.course} ${MEETING[c.meeting_type]} from "${c.evidence.quote}". ${reason} Is it right as read?`,
        options: [
          { id: "confirm", label: "Yes, it's right", value: "confirm", evidence: c.evidence },
          { id: "edit", label: "Let me fix it", value: null, evidence: null },
        ],
        input: "fields",
        suggested: null,
        why_suggested: null,
      });
    }

  // Weekly classes skip breaks: one question if no syllabus or schedule lists them.
  if (classes.length > 0 && breaks.check.status !== "verified")
    asked.push({
      id: "q_breaks",
      about: "term",
      type: "missing_fact",
      prompt: `Are there breaks with no classes this term, like Thanksgiving? Your weekly classes skip them.${breaks.check.reason && !breaks.check.reason.startsWith("No source") ? ` ${breaks.check.reason}` : ""}`,
      options: [
        { id: "none", label: "No breaks", value: "none", evidence: null },
        { id: "edit", label: "Add the dates", value: null, evidence: null },
      ],
      input: "dates",
      suggested: null,
      why_suggested: null,
    });

  const courses = [
    ...new Set([...classes.map((c) => c.course), ...items.flatMap((i) => (i.course ? [i.course] : []))]),
  ].sort();
  for (const item of items) {
    if (item.conflict) continue; // its one question is the conflict question
    if (!item.candidates.length) continue; // derived by code (a notice before an exam): nothing read to ask about
    // "Final exam: TBA": one note, no date to pick yet, nothing invented.
    if (item.tba && !item.date) {
      asked.push({
        id: `q_${item.id}_tba`,
        about: item.id,
        type: "missing_fact",
        prompt: `${item.title}: the date is TBA, so it has none yet. Check back near the last week of classes, and add it here once it's announced.`, // prettier-ignore
        options: [{ id: "edit", label: "Add the date", value: null, evidence: null }],
        input: "date",
        suggested: null,
        why_suggested: null,
      });
      continue;
    }
    if (asked.some((q) => q.about === item.id && q.type === "which_item")) continue;
    const members = item.candidates.map((id) => byId.get(id)!);
    const first = members[0];
    const q = (
      type: Question["type"],
      prompt: string,
      options: Question["options"],
      input: Question["input"],
      suggested: string | null = null,
    ) =>
      asked.push({
        id: `q_${item.id}_${type}`,
        about: item.id,
        type,
        prompt,
        options,
        input,
        suggested,
        why_suggested: null,
      });

    if (
      item.checks.quote.status === "unverified" ||
      item.checks.title.status === "unverified" ||
      item.checks.date.status === "unverified" ||
      item.checks.time.status === "unverified"
    ) {
      const reason = [item.checks.quote, item.checks.title, item.checks.date, item.checks.time].find(
        (c) => c.status === "unverified",
      )!.reason;
      q(
        "check",
        `I couldn't confirm "${first.evidence.quote}". ${reason} Is it right as read?`,
        [
          { id: "confirm", label: "Yes, it's right", value: "confirm", evidence: first.evidence },
          { id: "edit", label: "Let me fix it", value: null, evidence: null },
        ],
        "fields",
      );
      continue;
    }
    if (item.checks.quote.status === "needs_question") {
      q(
        "unreadable",
        `Is this "${first.evidence.quote}"?`,
        [
          { id: "as_read", label: first.evidence.quote, value: first.evidence.quote, evidence: first.evidence },
          ...(first.legibility.reread && first.legibility.reread !== first.evidence.quote
            ? [
                {
                  id: "reread",
                  label: first.legibility.reread,
                  value: first.legibility.reread,
                  evidence: first.evidence,
                },
              ]
            : []),
          { id: "edit", label: "Neither, let me type it", value: null, evidence: null },
        ],
        "text",
      );
    }
    if (item.checks.course.status === "needs_question")
      q(
        "course",
        `Which course is "${item.title}" for? ${item.checks.course.reason}`,
        [
          ...courses.map((code) => ({ id: `c_${code}`, label: code, value: code, evidence: first.evidence })),
          { id: "edit", label: "Another course", value: null, evidence: null },
        ],
        "course",
      );
    const dn = members.find((c) => c.date_needs)?.date_needs;
    // A date that depends on another item waits on that item's question, if it has one; it has none of its own.
    const waits = item.depends_on !== null || dn?.needs === "term_start" || dn?.needs === "photo_date";
    if (item.checks.date.status === "needs_question" && !waits)
      q(
        dn?.needs === "choice" ? "choose_date" : "missing_fact",
        `When is "${item.title}"? ${item.checks.date.reason}`,
        // No pre-selection: unlike a conflict, there's no reason to favour either date.
        [
          ...(dn?.options ?? []).map((d, i) => ({
            id: `d${i}`,
            label: formatDate(d),
            value: d,
            evidence: first.evidence,
          })),
          { id: "edit", label: "Pick the date", value: null, evidence: null },
        ],
        "date",
      );
    if (item.checks.time.status === "needs_question" && item.time?.trace.rule !== "before_item")
      q(
        `missing_fact`,
        `What time is "${item.title}"? ${item.checks.time.reason}`,
        [{ id: "edit", label: "Pick the time", value: null, evidence: null }],
        "time",
      );

    const hit = overlap(item, classes);
    if (hit) {
      const when = `${formatDate(item.date!.value)}, ${formatTime(item.time!.start)}-${formatTime(item.time!.end!)}`;
      q(
        "class_overlap",
        `${item.title} (${when}) overlaps your ${hit.course} ${MEETING[hit.meeting_type]} (${formatTime(hit.start)}-${formatTime(hit.end)}). Keep both?`,
        [
          { id: "keep", label: "Keep both as they are", value: "keep", evidence: item.evidence[0] },
          { id: "edit", label: "Let me fix the time", value: null, evidence: hit.evidence },
        ],
        "time",
      );
      if (item.checks.time.status === "verified") {
        item.checks.time = { status: "needs_question", reason: `Overlaps ${hit.course} ${MEETING[hit.meeting_type]}.` };
        item.status = worst(...Object.values(item.checks)).status;
      }
    }
  }

  asked.push(...syllabusQuestions(notes, classes, facts));

  return {
    zone,
    term_start: term,
    term_end: termEnd,
    term_breaks: breaks,
    classes,
    items,
    courses: courseInfo(notes, facts),
    questions: [...asked.filter((q) => q.about === "term"), ...questions, ...asked.filter((q) => q.about !== "term")],
    crossed_out: all.filter((c) => c.crossed_out),
  };
}

/**
 * "Notify me at least one week (7 days) in advance" of an exam conflict: for each dated exam from that syllabus, an
 * optional task due that many days before it. Its date is the exam's minus the notice, linked like any relative date,
 * so it moves with the exam and the audit recomputes it.
 */
function noticeItems(items: PlanItem[], byId: Map<string, Candidate>, notes: Map<string, SyllabusNotes>): PlanItem[] {
  const out: PlanItem[] = [];
  for (const exam of items) {
    if (exam.kind !== "exam" || exam.optional) continue;
    const src = exam.candidates.map((id) => byId.get(id)!).find((c) => notes.get(c.source.id)?.notice);
    const n = src && notes.get(src.source.id)!.notice!;
    const days = n ? parseNotice(n.text) : null;
    if (!n || !days) continue;
    const checks = { quote: verified, title: verified, course: verified, date: verified, time: verified };
    out.push({
      id: `notice_${exam.id}`,
      kind: "task",
      title: `Tell your instructor about any exam conflict (${exam.title})`,
      course: exam.course,
      family: null,
      number: null,
      date: null,
      time: null,
      evidence: [n.evidence],
      candidates: [],
      checks,
      conflict: null,
      depends_on: { item_id: exam.id, text: n.text, offset_days: -days },
      status: "verified",
      optional: "Only if you have a conflict",
    });
  }
  return out;
}

/** Office hours a syllabus lists, added as a weekly block only once the person said yes. */
function officeHours(
  notes: Map<string, SyllabusNotes>,
  facts: Facts,
  term: TermDate,
  termEnd: TermDate,
  zone: string,
  breaks: Plan["term_breaks"]["breaks"],
): ClassBlock[] {
  const out: ClassBlock[] = [];
  for (const [sourceId, n] of notes) {
    if (!n.course || !facts.office_hours?.[n.course]?.add) continue;
    // Their yes is the check: the quote was matched against the page when it was read.
    n.office_hours.forEach((h, i) => {
      const days = parseDays(h.days_text);
      const t = parseTime(h.time_text);
      if (!days?.length || !t.ok || t.kind !== "clock" || !t.end) return;
      const until = termEnd.date?.value ?? null;
      out.push({
        id: `office_${sourceId}_${i}`,
        source: n.source,
        course: n.course!,
        section: null,
        title: "Office hours",
        meeting_type: "other",
        marker: "Office hours (optional)",
        days,
        start: t.start,
        end: t.end,
        location: h.location,
        rrule: weeklyRrule(days, until ? { date: until, zone } : undefined),
        first_date: term.date ? { value: firstMeeting(days, term.date.value), trace: { text: h.days_text, evidence: h.evidence, rule: "first_meeting", inputs: { term_start: term.date.value, photo_date: null, added_date: null } } } : null, // prettier-ignore
        last_date: until ? { value: lastMeeting(days, until), trace: { text: h.days_text, evidence: h.evidence, rule: "last_meeting", inputs: { term_start: null, photo_date: null, added_date: null, term_end: until } } } : null, // prettier-ignore
        skip_dates: skipDates(days, breaks, term.date?.value ?? null, until),
        evidence: h.evidence,
        checks: { quote: verified, days: verified, time: verified },
        status: "verified",
      });
    });
  }
  return out;
}

/** Once they say which discussion is theirs: every meeting of it is a quiz day (no quiz dates are invented). */
function markQuizDays(classes: ClassBlock[], notes: Map<string, SyllabusNotes>, facts: Facts) {
  for (const n of notes.values()) {
    const pick = n.course ? facts.quiz_sections?.[n.course] : undefined;
    if (!pick || !n.quizzes) continue;
    const typed = pick.text.replace(/\D/g, "");
    const block =
      classes.find((c) => c.id === pick.class_id) ??
      classes.find((c) => c.course === n.course && c.meeting_type !== "lecture" && !!typed && c.section?.replace(/\D/g, "") === typed); // prettier-ignore
    if (block) block.marker = `Quiz day: quizzes happen in this ${MEETING[block.meeting_type]} ("${n.quizzes.text}")`;
  }
}

/** One question each: which section quizzes happen in, and whether to add office hours. */
function syllabusQuestions(notes: Map<string, SyllabusNotes>, classes: ClassBlock[], facts: Facts): Question[] {
  const out: Question[] = [];
  for (const n of notes.values()) {
    if (!n.course) continue;
    const where = n.quizzes?.where ?? "";
    if (n.quizzes && /discussion|section|lab|recitation/i.test(where) && !facts.quiz_sections?.[n.course]) {
      const kind = /lab/i.test(where) ? "lab" : "discussion";
      const sections = classes.filter((c) => c.course === n.course && c.meeting_type === kind);
      out.push({
        id: `q_quiz_section_${n.course}`,
        about: n.course,
        type: "missing_fact",
        prompt: `Which ${n.course} ${kind} section are you in? Quizzes happen there ("${n.quizzes.text}"), so I'll mark its meetings as quiz days instead of guessing dates.`, // prettier-ignore
        options: [
          ...sections.map((c) => ({
            id: c.id,
            label: `${c.section ? `${c.section}, ` : ""}${c.days.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(" ")} ${formatTime(c.start)}-${formatTime(c.end)}`, // prettier-ignore
            value: `class:${c.id}`,
            evidence: c.evidence,
          })),
          { id: "edit", label: "Type the section", value: null, evidence: null },
        ],
        input: "text",
        suggested: null,
        why_suggested: null,
      });
    }
    if (n.office_hours.length && !facts.office_hours?.[n.course]) {
      const list = n.office_hours.map((h) => `${h.days_text}, ${h.time_text}${h.location ? `, ${h.location}` : ""}`).join("; "); // prettier-ignore
      out.push({
        id: `q_office_hours_${n.course}`,
        about: n.course,
        type: "check",
        prompt: `The ${n.course} syllabus lists office hours (${list}). Add them to your week? They're optional.`,
        options: [
          { id: "add", label: "Yes, add them", value: "add", evidence: n.office_hours[0].evidence },
          { id: "no", label: "No thanks", value: "no", evidence: null },
        ],
        input: null,
        suggested: null,
        why_suggested: null,
      });
    }
  }
  return out;
}

/** Grade weights, topics, and quizzes per course, for study plans: never dates. */
function courseInfo(notes: Map<string, SyllabusNotes>, facts: Facts): CourseInfo[] {
  const out: CourseInfo[] = [];
  for (const n of notes.values()) {
    if (!n.course || (!n.weights.length && !n.topics.length && !n.quizzes)) continue;
    out.push({
      course: n.course,
      weights: n.weights,
      topics: n.topics,
      quizzes: n.quizzes ? { ...n.quizzes, section: facts.quiz_sections?.[n.course]?.text ?? null } : null,
    });
  }
  return out;
}
