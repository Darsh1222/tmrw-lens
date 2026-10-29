import { candidates, classBlocks, GRID_DAYS, termStart } from "@/lib/plan/candidates";
import { formatTime, merge } from "@/lib/plan/merge";
import type { Candidate, ClassBlock, Plan, PlanItem, Question, SourceReading } from "@/lib/plan/types";
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

export function buildPlan(readings: SourceReading[], { zone }: { zone: string }): Plan {
  const term = termStart(readings, zone);
  const classes = classBlocks(readings, term);
  const all = candidates(readings, term, zone).map((c) => fillInClass(c, classes));
  const live = all.filter((c) => !c.crossed_out);
  const { items, questions } = merge(live);
  const byId = new Map(all.map((c) => [c.id, c]));
  const asked: Question[] = [];

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
        suggested: null,
        why_suggested: null,
      });
    }

  for (const item of items) {
    if (item.conflict) continue; // its one question is the conflict question
    const members = item.candidates.map((id) => byId.get(id)!);
    const first = members[0];
    const q = (type: Question["type"], prompt: string, options: Question["options"], suggested: string | null = null) =>
      asked.push({ id: `q_${item.id}_${type}`, about: item.id, type, prompt, options, suggested, why_suggested: null });

    if (
      item.checks.quote.status === "unverified" ||
      item.checks.title.status === "unverified" ||
      item.checks.date.status === "unverified" ||
      item.checks.time.status === "unverified"
    ) {
      const reason = [item.checks.quote, item.checks.title, item.checks.date, item.checks.time].find(
        (c) => c.status === "unverified",
      )!.reason;
      q("check", `I couldn't confirm "${first.evidence.quote}". ${reason} Is it right as read?`, [
        { id: "confirm", label: "Yes, it's right", value: "confirm", evidence: first.evidence },
        { id: "edit", label: "Let me fix it", value: null, evidence: null },
      ]);
      continue;
    }
    if (item.checks.quote.status === "needs_question") {
      q("unreadable", `Is this "${first.evidence.quote}"?`, [
        { id: "as_read", label: first.evidence.quote, value: first.evidence.quote, evidence: first.evidence },
        ...(first.legibility.reread && first.legibility.reread !== first.evidence.quote
          ? [{ id: "reread", label: first.legibility.reread, value: first.legibility.reread, evidence: first.evidence }]
          : []),
        { id: "edit", label: "Neither, let me type it", value: null, evidence: null },
      ]);
    }
    if (item.checks.course.status === "needs_question")
      q("course", `Which course is "${item.title}" for? ${item.checks.course.reason}`, [
        { id: "edit", label: "Pick the course", value: null, evidence: first.evidence },
      ]);
    const dn = members.find((c) => c.date_needs)?.date_needs;
    if (item.checks.date.status === "needs_question" && dn?.needs !== "term_start" && dn?.needs !== "photo_date")
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
      );
    if (item.checks.time.status === "needs_question")
      q("missing_fact", `What time is "${item.title}"? ${item.checks.time.reason}`, [
        { id: "edit", label: "Pick the time", value: null, evidence: null },
      ]);

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
    classes,
    items,
    questions: [...asked.filter((q) => q.about === "term"), ...questions, ...asked.filter((q) => q.about !== "term")],
    crossed_out: all.filter((c) => c.crossed_out),
  };
}
