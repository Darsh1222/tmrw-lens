import { describe, expect, it } from "vitest";
import { REBUILD_CASES } from "../../evals/rebuild/cases";
import { RebuildRequest } from "@/lib/rebuild/contract";
import { emptyMemory, proposalProblems, recover, type RecoveryInput } from "@/lib/recovery/engine";
import {
  NextTask,
  applyTaskChange,
  beginNextTask,
  finishNextStep,
  nextStepKey,
  previewTaskChange,
  readNextTask,
  sourceMatchesDeadline,
  taskDeadline,
} from "@/lib/recovery/next-step";
function begin(name = "simple-move", moved = false) {
  const input: RecoveryInput = {
    request: RebuildRequest.parse(REBUILD_CASES.find((c) => c.name === name)!.request),
    obstacle: "stuck",
    category: "math",
    budget: 20,
    useEstimates: false,
    allowOneMove: moved,
    memory: emptyMemory(),
  };
  const result = recover(input);
  const plan = result.proposals.find((p) => p.id === (moved ? "make-room" : "starter")) ?? result.proposals[0];
  return beginNextTask(input, plan, null, false);
}
describe("evidence-linked next step", () => {
  it("credits an explicitly finished step once and preserves the entire remainder", () => {
    const task = begin(),
      key = nextStepKey(task)!;
    const next = finishNextStep(task, key, task.updatedAt);
    expect(next.completedMinutes).toBe(task.plan.placements[0].minutes);
    expect(next.remainingMinutes + next.completedMinutes).toBe(task.remainingMinutes);
    expect(next.plan.placements.reduce((n, p) => n + p.minutes, 0)).toBe(next.remainingMinutes);
    expect(proposalProblems(next.input, next.plan)).toEqual([]);
    expect(finishNextStep(next, key, next.updatedAt)).toEqual(next);
    expect(task.completedMinutes).toBe(0);
  });
  it("does not mark elapsed sessions complete when restored", () => {
    const task = begin();
    expect(readNextTask(JSON.stringify(task))?.status).toBe("active");
    expect(readNextTask(JSON.stringify(task))?.completedMinutes).toBe(0);
  });
  it("previews and applies only the reported remaining work without resetting finished steps", () => {
    const task = begin(),
      next = finishNextStep(task, nextStepKey(task)!, task.updatedAt);
    const before = JSON.stringify(next);
    const preview = previewTaskChange(next, 30, "interrupted", next.updatedAt);
    const plan = preview.result.proposals[0];
    expect(plan.required).toBe(30);
    expect(plan.moved).toEqual([]);
    expect(JSON.stringify(next)).toBe(before);
    const applied = applyTaskChange(next, preview.input, plan, next.updatedAt);
    expect(applied.completedMinutes).toBe(next.completedMinutes);
    expect(applied.remainingMinutes).toBe(30);
    expect(applied.originalEstimateMinutes).toBe(task.originalEstimateMinutes);
    expect(proposalProblems(applied.input, applied.plan)).toEqual([]);
  });
  it("keeps an earlier user-approved move when recovering the remaining task", () => {
    const task = begin("make-room", true);
    expect(task.plan.moved).toHaveLength(1);
    const preview = previewTaskChange(task, task.remainingMinutes, "interrupted", task.updatedAt);
    const moved = task.plan.moved[0];
    const item = preview.input.request.items.find((i) => i.id === moved.itemId)!;
    expect([item.start, item.end]).toEqual([moved.start, moved.end]);
    for (const p of preview.result.proposals) expect(proposalProblems(preview.input, p)).toEqual([]);
  });
  it("returns no complete proposal after a deadline and preserves the task", () => {
    const task = begin(),
      before = JSON.stringify(task);
    const preview = previewTaskChange(
      task,
      60,
      "interrupted",
      new Date(Date.parse(taskDeadline(task)!) + 60000).toISOString(),
    );
    expect(preview.result.proposals).toEqual([]);
    expect(JSON.stringify(task)).toBe(before);
  });
  it("rejects a preview whose schedule is already past at application time", () => {
    const task = begin(),
      preview = previewTaskChange(task, 30, "interrupted", task.updatedAt),
      plan = preview.result.proposals[0];
    expect(() =>
      applyTaskChange(task, preview.input, plan, new Date(Date.parse(plan.placements[0].start) + 60000).toISOString()),
    ).toThrow();
  });
  it("rejects weakening original commitments even if the edited proposal passes alone", () => {
    const task = begin(),
      preview = previewTaskChange(task, 30, "interrupted", task.updatedAt);
    preview.input.request.fixed = [];
    const plan = recover(preview.input).proposals[0];
    expect(() => applyTaskChange(task, preview.input, plan, task.updatedAt)).toThrow();
  });
  it("never silently attributes an edited deadline to the old source", () => {
    const task = begin(),
      item = task.input.request.items.find((i) => i.id === task.input.request.missed.item_id)!;
    task.source = {
      title: item.title,
      date: taskDeadline(task)!.slice(0, 10),
      time: null,
      zone: "UTC",
      evidence: [{ source: "Test syllabus", page: 1, quote: "Practice due Thursday", computed_from: null }],
    };
    expect(sourceMatchesDeadline(task)).toBe(true);
    task.source.date = "2026-01-01";
    expect(sourceMatchesDeadline(task)).toBe(false);
  });
  it("does not persist learning history inside a saved task and rejects tampered effort", () => {
    const task = begin();
    expect(task.input.memory.history).toEqual([]);
    task.remainingMinutes += 5;
    expect(readNextTask(JSON.stringify(task))).toBeNull();
    expect(readNextTask("not json")).toBeNull();
  });
  it("finishes only after the user reports every planned step", () => {
    let task = begin();
    while (task.status === "active") task = finishNextStep(task, nextStepKey(task)!, task.updatedAt);
    expect(task.remainingMinutes).toBe(0);
    expect(task.plan.placements).toEqual([]);
    expect(NextTask.parse(task).status).toBe("done");
    expect(() => previewTaskChange(task, 30, "interrupted", task.updatedAt)).toThrow();
  });
});

describe("effort and evidence boundaries", () => {
  it("freezes a calibrated plan once but retains the original estimate for learning", () => {
    const task = begin();
    const input = {
      ...task.input,
      useEstimates: true,
      memory: {
        ...emptyMemory(),
        history: [0, 1, 2].map((n) => ({
          id: `past_${n}`,
          category: "math",
          estimated: 60,
          actual: 120,
          at: task.updatedAt,
        })),
      },
    };
    const result = recover(input),
      plan = result.proposals[0];
    expect(plan).toBeDefined();
    const started = beginNextTask(input, plan, null, false);
    expect(started.remainingMinutes).toBe(result.estimate.minutes);
    expect(started.originalEstimateMinutes).toBe(result.estimate.base);
    expect(started.input.useEstimates).toBe(false);
    expect(started.input.memory.history).toEqual([]);
    expect(proposalProblems(started.input, started.plan)).toEqual([]);
  });
  it("does not let a tampered deadline dependency change the task's deadline", () => {
    const task = begin(),
      preview = previewTaskChange(task, 30, "interrupted", task.updatedAt);
    preview.input.request.items.find((i) => i.id === preview.input.request.missed.item_id)!.for = null;
    const plan = recover(preview.input).proposals[0];
    expect(() => applyTaskChange(task, preview.input, plan, task.updatedAt)).toThrow();
  });
});

it("protects an explicitly unavailable period when replanning the remainder", () => {
  const task = begin();
  const freeAt = new Date(Date.parse(task.updatedAt) + 3 * 3600000).toISOString();
  const preview = previewTaskChange(task, 30, "interrupted", task.updatedAt, freeAt);
  expect(preview.result.proposals.length).toBeGreaterThan(0);
  for (const plan of preview.result.proposals) {
    expect(plan.placements.every((p) => Date.parse(p.start) >= Date.parse(freeAt))).toBe(true);
    const applied = applyTaskChange(task, preview.input, plan, task.updatedAt);
    expect(applied.input.request.fixed).toEqual(expect.arrayContaining(task.input.request.fixed));
    expect(proposalProblems(applied.input, applied.plan)).toEqual([]);
  }
});
