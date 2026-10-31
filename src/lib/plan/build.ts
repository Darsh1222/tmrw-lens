import { DateTime } from "luxon";
import { answeredDate, candidates, classBlocks, GRID_DAYS, termBreaks, termDate } from "@/lib/plan/candidates";
import { linkDependents, propagate } from "@/lib/plan/depends";
import { formatTime, merge } from "@/lib/plan/merge";
import type { Candidate, ClassBlock, Facts, Plan, PlanItem, Question, SourceReading, TermDate } from "@/lib/plan/types";
import { worst } from "@/lib/plan/verify";
import { formatDate, minutesOf, parseTime, WEEKDAY_NAMES, weekdayOf } from "@/lib/resolve/dates";

// Everything after the model: readings in, a plan with statuses and questions
// out. Pure code, so it runs the same in the app, in tests, and in evals on
// recorded readings.

/** "in class" becomes the course's meeting that day, from the schedule. */
function fillInClass(c: Candidate, classes: ClassBlock[]): Candidate {
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
  const classes = classBlocks(readings, term, { termEnd, zone, breaks: breaks.breaks });
  const all = candidates(readings, term, zone).map((c) => fillInClass(c, classes));
  const live = all.filter((c) => !c.crossed_out);
  const { items, questions } = merge(live, { separate: facts.separate });
  const byId = new Map(all.map((c) => [c.id, c]));
  const asked: Question[] = linkDependents(items, byId);
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

  // Class days read off a grid: one question per screenshot, not one per class.
  const gridSources = new Set(classes.filter((c) => c.checks.days.reason === GRID_DAYS).map((c) => c.source.id));
  for (const sourceId of gridSources) {
    const read = classes.filter((c) => c.source.id === sourceId);
    asked.push({
      id: `q_grid_days_${sourceId}`,
      about: sourceId,
      type: "check",
      prompt: `I read which days each class meets from the columns of the ${read[0].source.label}. Are these right? ${read.map((c) => `${c.course} ${MEETING[c.meeting_type]}: ${c.days.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(" ")}`).join("; ")}.`,
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

  return {
    zone,
    term_start: term,
    term_end: termEnd,
    term_breaks: breaks,
    classes,
    items,
    questions: [...asked.filter((q) => q.about === "term"), ...questions, ...asked.filter((q) => q.about !== "term")],
    crossed_out: all.filter((c) => c.crossed_out),
  };
}
