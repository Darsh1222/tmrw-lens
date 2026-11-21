import { describe, expect, it } from "vitest";
import { RebuildRequest } from "@/lib/rebuild/contract";
import { REBUILD_CASES } from "../../evals/rebuild/cases";
import { emptyMemory, recover, type RecoveryInput } from "@/lib/recovery/engine";
import {
  scheduleDeadlines,
  scheduleEvents,
  scheduleSegments,
  type ScheduleEvent,
  type ScheduleSnapshot,
} from "@/lib/recovery/schedule";
function snapshot(example = true): ScheduleSnapshot {
  const request = RebuildRequest.parse(REBUILD_CASES.find((c) => c.name === "simple-move")!.request);
  const input: RecoveryInput = {
    request,
    obstacle: "stuck",
    budget: 20,
    category: "math",
    useEstimates: false,
    allowOneMove: false,
    memory: emptyMemory(),
  };
  return {
    request,
    baseline: structuredClone(request),
    plan: recover(input).proposals[0],
    phase: "preview",
    example,
    completedMinutes: 0,
  };
}
describe("live schedule projection", () => {
  it("uses the checked proposal's exact times and protects unchanged event data", () => {
    const s = snapshot(),
      before = JSON.stringify(s),
      events = scheduleEvents(s);
    const work = events.filter((e) => e.kind === "work");
    expect(work.map((p) => [p.start, p.end])).toEqual(s.plan!.placements.map((p) => [p.start, p.end]));
    expect(work.reduce((n, p) => n + p.minutes, 0)).toBe(s.plan!.required);
    expect(events.filter((e) => e.kind === "fixed").map((p) => [p.title, p.start, p.end])).toEqual(
      s.request.fixed.map((p) => [p.title, p.start, p.end]),
    );
    expect(JSON.stringify(s)).toBe(before);
  });
  it("keeps the work identity stable when a recorded missed session moves", () => {
    const s = snapshot(),
      before = scheduleEvents(s, true).find((e) => e.kind === "work")!;
    const after = scheduleEvents(s).find((e) => e.kind === "work")!;
    expect(before.key).toBe(after.key);
    expect(after.start).not.toBe(before.start);
    expect(scheduleEvents(s).some((e) => e.kind === "ghost")).toBe(true);
  });
  it("never invents a missed time for a newly entered personal task", () => {
    const s = snapshot(false);
    s.plan = null;
    s.phase = "before";
    expect(scheduleEvents(s).some((e) => e.kind === "work" || e.kind === "ghost")).toBe(false);
  });
  it("shows prior approved placements when comparing a new preview", () => {
    const s = snapshot();
    s.previous = structuredClone(s.plan);
    expect(
      scheduleEvents(s, true)
        .filter((e) => e.kind === "work")
        .map((p) => p.start),
    ).toEqual(s.previous!.placements.map((p) => p.start));
  });
  it("splits midnight spans without creating invalid local hours, across DST", () => {
    const e: ScheduleEvent = {
      key: "overnight",
      title: "Shift",
      start: "2026-10-31T23:00:00-04:00",
      end: "2026-11-01T03:00:00-05:00",
      minutes: 300,
      kind: "fixed",
    };
    const parts = scheduleSegments([e], "America/New_York", ["2026-10-31", "2026-11-01"]);
    expect(parts.map((p) => [p.day, p.from, p.to])).toEqual([
      ["2026-10-31", 23, 24],
      ["2026-11-01", 0, 3],
    ]);
    expect(new Set(parts.map((p) => p.key)).size).toBe(parts.length);
  });
  it("separates visual short-step collisions without changing their actual times", () => {
    const a: ScheduleEvent = {
      key: "a",
      title: "Start",
      start: "2026-11-04T19:00:00-05:00",
      end: "2026-11-04T19:10:00-05:00",
      minutes: 10,
      kind: "work",
    };
    const b = { ...a, key: "b", start: "2026-11-04T19:20:00-05:00", end: "2026-11-04T20:00:00-05:00", minutes: 40 };
    const parts = scheduleSegments([a, b], "America/New_York", ["2026-11-04"]);
    expect(parts[0].lane).not.toBe(parts[1].lane);
    expect(parts.map((p) => p.start)).toEqual([a.start, b.start]);
  });
  it("does not collapse unrelated deadlines at the same time", () => {
    const s = snapshot(),
      missed = s.request.items.find((i) => i.id === s.request.missed.item_id)!;
    missed.for = null;
    missed.due = s.request.deadlines[0].due;
    const deadlines = scheduleDeadlines(s).filter((d) => d.due === missed.due);
    expect(deadlines).toHaveLength(2);
    expect(new Set(deadlines.map((d) => d.id)).size).toBe(2);
  });
  it("retains linked deadlines and includes directly entered deadlines", () => {
    const s = snapshot();
    expect(scheduleDeadlines(s)).toEqual(s.request.deadlines);
    const missed = s.request.items.find((i) => i.id === s.request.missed.item_id)!;
    missed.due = "2026-11-05T23:59:00-05:00";
    expect(scheduleDeadlines(s).some((d) => d.due === missed.due)).toBe(true);
  });
});
