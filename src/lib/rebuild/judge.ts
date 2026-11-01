import { z } from "zod";
import type { Task } from "@/lib/meta/task";

// Scores a rebuild's recovery message for the evals (PLAN's quality bar: "a
// judge score for rebuild messages"). Code already guarantees the moves fit and
// the times are right; the judge reads what code can't: whether the choice is
// sensible for this student and the reason is true, specific, and calm.

export const Judgement = z.object({
  score: z.int().min(1).max(5),
  /** What keeps it from a 5, in a few words each. Empty for a 5. */
  problems: z.array(z.string().max(400)).max(5),
});
export type Judgement = z.infer<typeof Judgement>;

export const judgeTask: Task<Judgement> = {
  name: "judge_rebuild",
  version: 2,
  instructions: `You grade one recovery message from a student planner. A planned session passed undone; the planner moved or dropped things and sent the student one message. You get the facts (their plan, deadlines, free time, and their reply), the changes, and the message.

Score 1-5:
5: the choice is sensible for this student (before the deadline, respects what they said, changes as little as possible) and every reason is true to the facts, specific, plain, and calm.
4: sensible and true, with one small issue (a vague reason, a slightly worse slot than an obvious better one).
3: acceptable but a clearly better choice existed, or a reason is generic.
2: a reason is false or misleading, or the choice ignores what they said.
1: the choice harms them (misses the deadline, overloads a day they said was out) or the message guilts, scolds, cheers, or pressures.
The times in the message are computed by code and correct; don't grade their format. List what keeps it from a 5 (empty for a 5).`,
  schema: Judgement,
  check: (j) => (j.score < 5 && !j.problems.length ? "Say what keeps it from a 5." : null),
  effort: "low",
  maxOutputTokens: 3_000,
};
