import { propagate } from "@/lib/plan/depends";
import type { Plan, PlanItem } from "@/lib/plan/types";
import { worst } from "@/lib/plan/verify";

// Applying the person's answer to a question. Nothing is applied until they
// answer; a pre-selected option is only a suggestion. After every answer,
// dates that depend on the answered item are recomputed, so "the day after
// Quiz 3" moves when the Quiz 3 conflict is settled.

export class UnsupportedAnswer extends Error {}

const settled = (why: string) => ({ status: "verified" as const, reason: why });

/** Returns a new plan with the answer applied and the question gone. */
export function answerQuestion(plan: Plan, questionId: string, optionId: string): Plan {
  const next = structuredClone(plan);
  const q = next.questions.find((x) => x.id === questionId);
  if (!q) throw new Error(`no question ${questionId}`);
  const option = q.options.find((o) => o.id === optionId);
  if (!option) throw new Error(`question ${questionId} has no option ${optionId}`);
  const item = next.items.find((i) => i.id === q.about);

  if (q.type === "conflict" && item?.conflict) {
    if (option.value === "different") throw new UnsupportedAnswer("splitting a conflict into two items");
    const v = item.conflict.versions[Number(optionId.slice(1))];
    if (!v) throw new Error(`no version for ${optionId}`);
    pick(item, v);
  } else if (q.type === "which_item" && item?.depends_on && option.value?.startsWith("item:")) {
    item.depends_on.item_id = option.value.slice("item:".length);
  } else {
    throw new UnsupportedAnswer(`${q.type} answers`);
  }

  next.questions = next.questions.filter((x) => x.id !== questionId);
  propagate(next.items);
  return next;
}

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
  item.status = worst(...Object.values(item.checks)).status;
}
