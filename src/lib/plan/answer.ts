import { answerEvidence, answeredDate } from "@/lib/plan/candidates";
import { propagate } from "@/lib/plan/depends";
import type { Check, ClassBlock, Plan, PlanItem, Question, TracedTime } from "@/lib/plan/types";
import { worst } from "@/lib/plan/verify";
import { parseDays, parseTime, weeklyRrule } from "@/lib/resolve/dates";

// Applying the person's answer to a question. Nothing is applied until they
// answer; a pre-selected option is only a suggestion. After every answer,
// dates that depend on the answered item are recomputed, so "the day after
// Quiz 3" moves when the Quiz 3 conflict is settled.
//
// Answers that change how the readings resolve (the first or last day of
// classes, when a photo was taken, breaks, "two different items") aren't
// applied here: they're facts, and the plan is rebuilt with them (session.ts).
// Edits and confirmations from an item's card are answers too, to the
// pseudo-questions "edit:<id>", "confirm:<id>", and "skip:<id>".

export class UnsupportedAnswer extends Error {}
export class BadAnswer extends Error {}

export type Answer = {
  question_id: string;
  option_id: string;
  /** What the person typed for a "let me type it" option: a date, a time, a course, text, or JSON fields. */
  value?: string | null;
};

/** Fields typed in an item's (or class's) editor. Absent fields stay as they are. */
export type ItemEdit = { title?: string; date?: string; time?: string; course?: string };
export type ClassEdit = { days?: string; start?: string; end?: string };

const settled = (why: string): Check => ({ status: "verified", reason: why });
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function date(value: string | null | undefined): string {
  if (!value || !ISO_DATE.test(value)) throw new BadAnswer(`"${value ?? ""}" isn't a date`);
  return value;
}

function time(value: string, question: string): TracedTime {
  const t = parseTime(value);
  if (!t.ok || t.kind !== "clock") throw new BadAnswer(t.ok ? `"${value}" isn't a clock time` : t.reason);
  return { start: t.start, end: t.end, trace: { text: value, evidence: answerEvidence(question, value), rule: "answer", class_id: null } }; // prettier-ignore
}

function fields<T>(value: string | null | undefined): T {
  try {
    const v = JSON.parse(value ?? "") as unknown;
    if (v && typeof v === "object") return v as T;
  } catch {
    // not JSON
  }
  throw new BadAnswer("the edit isn't readable");
}

function restatus(item: PlanItem) {
  item.status = worst(...Object.values(item.checks)).status;
}

function setDate(item: PlanItem, value: string, question: string, why: string) {
  item.date = answeredDate(date(value), question);
  item.depends_on = null;
  item.checks.date = settled(why);
}

function edit(item: PlanItem, e: ItemEdit, question: string) {
  const why = "You edited this.";
  if (e.title?.trim()) {
    item.title = e.title.trim();
    item.checks.title = settled(why);
    item.checks.quote = settled(why);
  }
  if (e.course?.trim()) {
    item.course = e.course.trim().toUpperCase().replace(/\s+/g, "");
    item.checks.course = settled(why);
  }
  if (e.date) setDate(item, e.date, question, why);
  if (e.time) {
    item.time = time(e.time, question);
    item.checks.time = settled(why);
  }
}

/**
 * Every check the person has now looked at and accepted. A date or time that was never read can't be confirmed into
 * existence (they edit it instead); a conflict is settled only by its question.
 */
function confirm(item: PlanItem, why: string) {
  const c = item.checks;
  for (const k of ["quote", "title", "course"] as const) if (c[k].status !== "verified") c[k] = settled(why);
  if (c.date.status !== "verified" && c.date.status !== "conflict" && (item.date || item.kind === "task"))
    c.date = settled(why);
  if (c.time.status !== "verified" && c.time.status !== "conflict" && item.time) c.time = settled(why);
}

function editClass(c: ClassBlock, e: ClassEdit, zoneUntil: { date: string; zone: string } | undefined) {
  const why = "You edited this.";
  if (e.days) {
    const d = parseDays(e.days);
    if (!d?.length) throw new BadAnswer(`"${e.days}" isn't a set of days`);
    c.days = d;
    c.rrule = weeklyRrule(d, zoneUntil);
    c.checks.days = settled(why);
  }
  for (const k of ["start", "end"] as const)
    if (e[k]) {
      const t = parseTime(e[k]);
      if (!t.ok || t.kind !== "clock") throw new BadAnswer(`"${e[k]}" isn't a time`);
      c[k] = t.start;
      c.checks.time = settled(why);
    }
  c.checks.quote = settled(why);
}

function classStatus(c: ClassBlock) {
  c.status = worst(c.checks.quote, c.checks.days, c.checks.time).status;
}

/** Returns a new plan with the answer applied and its question gone. */
export function answerQuestion(plan: Plan, questionId: string, optionId: string, value?: string | null): Plan {
  return applyAnswer(plan, { question_id: questionId, option_id: optionId, value });
}

export function applyAnswer(plan: Plan, a: Answer): Plan {
  const next = structuredClone(plan);
  const colon = a.question_id.indexOf(":");
  const pseudo = colon > 0 ? a.question_id.slice(0, colon) : "";
  const target = colon > 0 ? a.question_id.slice(colon + 1) : "";
  if (target && (pseudo === "edit" || pseudo === "confirm" || pseudo === "skip")) {
    const item = next.items.find((i) => i.id === target);
    const cls = next.classes.find((c) => c.id === target);
    if (!item && !cls) throw new BadAnswer(`nothing called ${target}`);
    if (pseudo === "skip") next.skipped = [...new Set([...(next.skipped ?? []), target])];
    else if (item && pseudo === "edit") edit(item, fields<ItemEdit>(a.value), a.question_id);
    else if (item) confirm(item, "You confirmed this.");
    else if (cls && pseudo === "edit") editClass(cls, fields<ClassEdit>(a.value), until(next));
    else if (cls) for (const k of ["quote", "days", "time"] as const) cls.checks[k] = settled("You confirmed this.");
    if (item) {
      restatus(item);
      if (item.status === "verified") next.questions = next.questions.filter((q) => q.about !== item.id);
    }
    if (cls) {
      classStatus(cls);
      if (cls.status === "verified") next.questions = next.questions.filter((q) => q.about !== cls.id);
    }
    propagate(next.items);
    return next;
  }

  const q = next.questions.find((x) => x.id === a.question_id);
  if (!q) throw new BadAnswer(`no question ${a.question_id}`);
  const option = q.options.find((o) => o.id === a.option_id);
  if (!option) throw new BadAnswer(`question ${a.question_id} has no option ${a.option_id}`);
  const typed = option.value === null;
  const item = next.items.find((i) => i.id === q.about);

  if (item) applyToItem(next, item, q, option.value, typed ? a.value : null);
  else applyToRest(next, q, option.value, typed ? a.value : null);

  next.questions = next.questions.filter((x) => x.id !== q.id);
  propagate(next.items);
  return next;
}

function applyToItem(plan: Plan, item: PlanItem, q: Question, value: string | null, typed: string | null | undefined) {
  const picked = "You picked this.";
  switch (q.type) {
    case "conflict": {
      if (value === "different") throw new UnsupportedAnswer("two different items is a fact; see session.ts");
      const v = item.conflict?.versions[Number(q.options.find((o) => o.value === value)?.id.slice(1))];
      if (!v) throw new BadAnswer("no such version");
      pick(item, v);
      break;
    }
    case "which_item":
      if (value?.startsWith("item:") && item.depends_on) item.depends_on.item_id = value.slice("item:".length);
      else setDate(item, typed ?? "", q.id, "You gave the date.");
      break;
    case "choose_date":
      setDate(item, value ?? typed ?? "", q.id, value ? picked : "You gave the date.");
      break;
    case "missing_fact":
      if (q.input === "time") {
        item.time = time(typed ?? "", q.id);
        item.checks.time = settled("You gave the time.");
      } else setDate(item, typed ?? "", q.id, "You gave the date.");
      break;
    case "course": {
      const code = (value ?? typed ?? "").trim().toUpperCase().replace(/\s+/g, "");
      if (!code) throw new BadAnswer("no course");
      item.course = code;
      item.checks.course = settled(picked);
      break;
    }
    case "unreadable":
      if (q.options.find((o) => o.value === value)?.id !== "as_read") {
        const words = (value ?? typed ?? "").trim();
        if (!words) throw new BadAnswer("nothing typed");
        item.title = words;
        item.checks.title = settled("You corrected the reading.");
      }
      item.checks.quote = settled(value ? picked : "You corrected the reading.");
      break;
    case "check":
      if (value === "confirm") confirm(item, "You confirmed this.");
      else {
        edit(item, fields<ItemEdit>(typed), q.id);
        confirm(item, "You edited this.");
      }
      break;
    case "class_overlap":
      if (value === "keep") item.checks.time = settled("You're keeping both.");
      else {
        item.time = time(typed ?? "", q.id);
        item.checks.time = settled("You gave the time.");
      }
      break;
  }
  restatus(item);
}

/** Questions about a class, or a whole screenshot's class days. */
function applyToRest(plan: Plan, q: Question, value: string | null, typed: string | null | undefined) {
  const classes = plan.classes.filter((c) => c.id === q.about || c.source.id === q.about);
  if (q.type !== "check" || !classes.length) throw new UnsupportedAnswer(`${q.id} is a fact; see session.ts`);
  if (value === "confirm") {
    for (const c of classes) {
      if (q.about === c.id && c.checks.quote.status !== "verified") c.checks.quote = settled("You confirmed this.");
      for (const k of ["days", "time"] as const)
        if (q.about === c.id || c.checks[k].status === "needs_question") c.checks[k] = settled("You confirmed this.");
      classStatus(c);
    }
    return;
  }
  // One class's fields, or for a screenshot, days per class id: {"class_ab12": "MWF"}.
  const edits = fields<Record<string, string> & ClassEdit>(typed);
  for (const c of classes) {
    if (q.about === c.id) editClass(c, edits, until(plan));
    else if (edits[c.id]) editClass(c, { days: edits[c.id] }, until(plan));
    else c.checks.days = settled("You confirmed this.");
    classStatus(c);
  }
}

const until = (plan: Plan) => (plan.term_end.date ? { date: plan.term_end.date.value, zone: plan.zone } : undefined);

function pick(item: PlanItem, v: NonNullable<PlanItem["conflict"]>["versions"][number]) {
  const c = item.conflict!;
  const why = "You picked this version.";
  if (c.fields.includes("date") || c.maybe_different) {
    item.date = v.date;
    item.checks.date = settled(why);
  }
  if (c.fields.includes("time")) {
    item.time = v.time;
    item.checks.time = settled(why);
  }
  c.chosen = v.candidate_id;
}
