import { z } from "zod";
import { DateTime } from "luxon";
import { EvidenceRef, type ImportRequest } from "@/lib/tomorrow/contract";
import { RecoveryInput, emptyMemory, proposalProblems, recover, type Obstacle, type Proposal } from "./engine";
import { completionKey } from "./workspace";

const MIN = 60_000;
export const NEXT_STEP_KEY = "lens_next_step_v1";
const Instant = z.iso.datetime({ offset: true });
const Placement = z.object({
  itemId: z.string().max(64),
  title: z.string().max(200),
  start: Instant,
  end: Instant,
  minutes: z.number().int().min(5).max(600),
  starter: z.boolean(),
});
const Plan = z.object({
  id: z.string().max(80),
  title: z.string().max(200),
  why: z.string().max(500),
  tradeoff: z.string().max(500),
  placements: z.array(Placement).max(8),
  moved: z.array(Placement).max(1),
  required: z.number().int().min(0).max(600),
  remaining: z.literal(0),
  otherChanges: z.number().int().min(0).max(1),
});
export const TaskSource = z.object({
  lensId: z.string().max(80).optional(),
  title: z.string().max(200),
  date: z.iso.date().nullable(),
  time: z.string().nullable(),
  zone: z.string().max(100),
  evidence: z.array(EvidenceRef).min(1).max(5),
});
export type TaskSource = z.infer<typeof TaskSource>;
export const NextTask = z
  .object({
    version: z.literal(1),
    id: z.string().max(80),
    example: z.boolean(),
    category: z.string().min(1).max(60),
    input: RecoveryInput,
    plan: Plan,
    source: TaskSource.nullable(),
    originalEstimateMinutes: z.number().int().min(5).max(600),
    completedMinutes: z.number().int().min(0).max(10000),
    remainingMinutes: z.number().int().min(0).max(600),
    status: z.enum(["active", "done"]),
    updatedAt: Instant,
    revision: z.number().int().nonnegative(),
  })
  .superRefine((task, ctx) => {
    if (task.input.useEstimates || task.input.memory.history.length)
      ctx.addIssue({
        code: "custom",
        message: "Active work must use its confirmed remaining estimate without stored learning history.",
      });
    if ((task.status === "done") !== (task.remainingMinutes === 0))
      ctx.addIssue({ code: "custom", message: "Completion and remaining work disagree." });
    if (
      task.plan.required !== task.remainingMinutes ||
      task.plan.placements.reduce((n, p) => n + p.minutes, 0) !== task.remainingMinutes
    )
      ctx.addIssue({ code: "custom", message: "Every remaining minute must stay in the plan." });
    if (task.status === "active" && proposalProblems(task.input, task.plan).length)
      ctx.addIssue({ code: "custom", message: "Saved plan needs review." });
  });
export type NextTask = z.infer<typeof NextTask>;

export function sourceForTask(payload: ImportRequest | null, id: string): TaskSource | null {
  const item = payload?.items.find((i) => i.lens_id === id);
  return item && item.kind !== "class_block"
    ? TaskSource.parse({
        lensId: item.lens_id,
        title: item.title,
        date: item.date,
        time: item.start_time,
        zone: payload!.zone,
        evidence: item.evidence,
      })
    : null;
}
export function taskDeadline(task: NextTask): string | null {
  const item = task.input.request.items.find((i) => i.id === task.input.request.missed.item_id)!;
  return item.due ?? task.input.request.deadlines.find((d) => d.id === item.for)?.due ?? null;
}
export function sourceMatchesDeadline(task: NextTask): boolean {
  const source = task.source,
    item = task.input.request.items.find((i) => i.id === task.input.request.missed.item_id)!;
  const deadline = taskDeadline(task);
  if (!source || !deadline) return false;
  const due = DateTime.fromISO(deadline, { zone: source.zone });
  // A date-only source never verifies a chosen clock time.
  return (
    item.title === source.title &&
    due.toISODate() === source.date &&
    (!source.time || due.toFormat("HH:mm") === source.time)
  );
}
function withMinutes(input: RecoveryInput, minutes: number): RecoveryInput {
  return {
    ...input,
    useEstimates: false,
    memory: { ...emptyMemory(), preferDaytime: input.memory.preferDaytime },
    request: {
      ...input.request,
      items: input.request.items.map((i) =>
        i.id !== input.request.missed.item_id
          ? i
          : { ...i, start: new Date(Date.parse(i.end) - minutes * MIN).toISOString(), min_minutes: 5 },
      ),
    },
  };
}
export function beginNextTask(
  input: RecoveryInput,
  plan: Proposal,
  source: TaskSource | null,
  example: boolean,
): NextTask {
  if (proposalProblems(input, plan).length) throw new Error("Review this plan before using it.");
  const frozen = withMinutes(structuredClone(input), plan.required);
  delete frozen.request.user_ref;
  return NextTask.parse({
    version: 1,
    id: completionKey(input.request),
    example,
    category: input.category,
    input: frozen,
    plan,
    source,
    originalEstimateMinutes:
      Math.ceil(
        (Date.parse(input.request.items.find((i) => i.id === input.request.missed.item_id)!.end) -
          Date.parse(input.request.items.find((i) => i.id === input.request.missed.item_id)!.start)) /
          (5 * MIN),
      ) * 5,
    completedMinutes: 0,
    remainingMinutes: plan.required,
    status: "active",
    updatedAt: input.request.now,
    revision: 0,
  });
}
export function nextStepKey(task: NextTask): string | null {
  const p = task.plan.placements[0];
  return p ? `${p.itemId}:${p.start}:${p.end}` : null;
}
/** Explicitly finishing the shown step credits its planned work once, never elapsed clock time. */
export function finishNextStep(raw: NextTask, expectedKey: string, at: string): NextTask {
  const task = NextTask.parse(raw);
  if (task.status === "done" || nextStepKey(task) !== expectedKey) return task;
  if (Date.parse(Instant.parse(at)) < Date.parse(task.updatedAt)) throw new Error("Check your device clock.");
  const step = task.plan.placements[0],
    remaining = task.remainingMinutes - step.minutes;
  const input = remaining ? withMinutes(task.input, remaining) : task.input;
  return NextTask.parse({
    ...task,
    input,
    plan: { ...task.plan, placements: task.plan.placements.slice(1), required: remaining },
    remainingMinutes: remaining,
    completedMinutes: task.completedMinutes + step.minutes,
    status: remaining ? "active" : "done",
    revision: task.revision + 1,
    updatedAt: Instant.parse(at),
  });
}
/** Preview only: keep all other applied commitments and re-plan precisely the reported remaining work. */
export function previewTaskChange(
  raw: NextTask,
  remaining: number,
  obstacle: Obstacle,
  at: string,
  freeAgainAt?: string,
) {
  const task = NextTask.parse(raw);
  if (task.status !== "active") throw new Error("This task is already finished.");
  z.number().int().min(5).max(600).multipleOf(5).parse(remaining);
  const now = Instant.parse(at);
  if (Date.parse(now) < Date.parse(task.updatedAt)) throw new Error("Check your device clock before replanning.");
  let input = withMinutes(task.input, remaining);
  input = {
    ...input,
    obstacle,
    allowOneMove: false,
    request: {
      ...input.request,
      now,
      items: input.request.items.map((item) => {
        const moved = task.plan.moved.find((p) => p.itemId === item.id);
        return moved ? { ...item, start: moved.start, end: moved.end } : item;
      }),
    },
  };
  if (freeAgainAt) {
    const end = Instant.parse(freeAgainAt);
    if (Date.parse(end) <= Date.parse(now)) throw new Error("Choose a future time when you are free again.");
    input.request.fixed = [...input.request.fixed, { title: "Unavailable until the time you chose", start: now, end }];
  }
  return { input, result: recover(input) };
}
export function applyTaskChange(raw: NextTask, input: RecoveryInput, plan: Proposal, at: string): NextTask {
  const task = NextTask.parse(raw);
  const now = Instant.parse(at);
  if (Date.parse(now) < Date.parse(task.updatedAt)) throw new Error("Check your device clock.");
  input = { ...input, request: { ...input.request, now } };
  const old = task.input.request.items.find((i) => i.id === task.input.request.missed.item_id)!;
  const item = input.request.items.find((i) => i.id === input.request.missed.item_id)!;
  const expectedItems = task.input.request.items
    .filter((i) => i.id !== old.id)
    .map((i) => {
      const moved = task.plan.moved.find((p) => p.itemId === i.id);
      return moved ? { ...i, start: moved.start, end: moved.end } : i;
    });
  const sameConstraints =
    JSON.stringify([
      input.request.open_windows,
      input.request.prefs,
      input.request.deadlines,
      input.request.items.filter((i) => i.id !== old.id),
    ]) ===
    JSON.stringify([
      task.input.request.open_windows,
      task.input.request.prefs,
      task.input.request.deadlines,
      expectedItems,
    ]);
  const keepsFixed = task.input.request.fixed.every((original) =>
    input.request.fixed.some((current) => JSON.stringify(current) === JSON.stringify(original)),
  );
  if (
    !keepsFixed ||
    !sameConstraints ||
    input.allowOneMove ||
    input.memory.preferDaytime !== task.input.memory.preferDaytime ||
    item.id !== old.id ||
    item.title !== old.title ||
    item.due !== old.due ||
    item.for !== old.for ||
    input.budget !== task.input.budget ||
    proposalProblems(input, plan).length
  )
    throw new Error("The task or its constraints changed. Review it again.");
  return NextTask.parse({
    ...task,
    input: withMinutes(input, plan.required),
    plan,
    remainingMinutes: plan.required,
    updatedAt: Instant.parse(at),
    revision: task.revision + 1,
  });
}
/** Reject stale/corrupt data without changing the original stored record. */
export function readNextTask(value: string | null): NextTask | null {
  if (!value || value.length > 250000) return null;
  try {
    return NextTask.parse(JSON.parse(value));
  } catch {
    return null;
  }
}
