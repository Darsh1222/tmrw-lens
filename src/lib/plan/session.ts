import { applyAnswer, BadAnswer, type Answer } from "@/lib/plan/answer";
import { buildPlan, withFacts } from "@/lib/plan/build";
import type { Facts, Plan, Question, SourceMeta, SourceReading } from "@/lib/plan/types";
import { parseDateRange } from "@/lib/resolve/dates";

// A plan is the readings plus the person's answers, replayed in order. Lens
// keeps no state: the page holds the readings and the answers, and this
// rebuilds the plan from them after every answer. Answers that change how the
// readings resolve become facts and rebuild the plan; the rest are applied on
// top, again after every rebuild. An answer whose question no longer exists
// (a rebuild settled it another way) is dropped, not forced.

export type Session = {
  plan: Plan;
  /** The sources as resolved (with any photo date the person gave), for the audit. */
  sources: SourceMeta[];
  /** Answers that applied, in order; the rest were stale. */
  applied: Answer[];
  /** Why an answer was refused (a date that isn't a date), keyed by question id. */
  errors: Record<string, string>;
};

const FACT = /^q_(term_start|term_end|breaks|photo_date_)/;

function factFrom(plan: Plan, q: Question, a: Answer, added: string | null): Partial<Facts> | null {
  const option = q.options.find((o) => o.id === a.option_id);
  if (!option) throw new BadAnswer(`question ${q.id} has no option ${a.option_id}`);
  const typed = option.value === null ? (a.value ?? "").trim() : "";
  const date = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(typed)) throw new BadAnswer(`"${typed}" isn't a date`);
    return { date: typed, question: q.id };
  };
  if (q.type === "conflict" && option.value === "different") {
    const item = plan.items.find((i) => i.id === q.about);
    const ids = item?.conflict?.versions.map((v) => v.candidate_id) ?? [];
    const pairs: [string, string][] = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
    return { separate: pairs };
  }
  if (!FACT.test(q.id)) return null;
  if (q.id === "q_term_start") return { term_start: date() };
  if (q.id === "q_term_end") return { term_end: date() };
  if (q.id.startsWith("q_photo_date_")) return { photo_dates: { [q.about]: date() } };
  if (option.value === "none") return { breaks: [] };
  // "Nov 25-29; Mar 16-20": each range resolved in code, with the plan's term start for the year.
  const inputs = {
    term_start: plan.term_start.date?.value ?? null,
    photo_date: null,
    added_date: added,
  };
  const breaks = typed
    .split(/[;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => {
      const r = parseDateRange(text, inputs);
      if (!r.ok) throw new BadAnswer(r.reason);
      return { name: "Break", text, start: r.start, end: r.end, question: q.id };
    });
  if (!breaks.length) throw new BadAnswer("no dates");
  return { breaks };
}

function mergeFacts(a: Facts, b: Partial<Facts>): Facts {
  return {
    ...a,
    ...b,
    photo_dates: { ...a.photo_dates, ...b.photo_dates },
    separate: [...(a.separate ?? []), ...(b.separate ?? [])],
  };
}

export function planFrom(readings: SourceReading[], { zone, answers }: { zone: string; answers: Answer[] }): Session {
  let facts: Facts = {};
  const added = readings[0]?.source.added_at.slice(0, 10) ?? null;
  const onTop: Answer[] = [];
  const applied: Answer[] = [];
  const errors: Record<string, string> = {};
  const replay = () => {
    let p = buildPlan(readings, { zone, facts });
    for (const a of onTop) {
      try {
        p = applyAnswer(p, a);
      } catch {
        // Settled another way by the rebuild.
      }
    }
    return p;
  };
  let plan = buildPlan(readings, { zone, facts });
  for (const a of answers) {
    const pseudo = /^(edit|confirm|skip):/.test(a.question_id);
    const q = plan.questions.find((x) => x.id === a.question_id);
    if (!q && !pseudo) continue;
    try {
      const f = q ? factFrom(plan, q, a, added) : null;
      if (f) {
        facts = mergeFacts(facts, f);
        plan = replay();
      } else {
        plan = applyAnswer(plan, a);
        onTop.push(a);
      }
      applied.push(a);
    } catch (e) {
      if (!(e instanceof BadAnswer)) throw e;
      errors[a.question_id] = e.message;
    }
  }
  return { plan, sources: withFacts(readings, facts, zone).map((r) => r.source), applied, errors };
}
