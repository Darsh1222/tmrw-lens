import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { RebuildRequest } from "@/lib/rebuild/contract";
import { emptyMemory, recover, proposalProblems, type RecoveryInput } from "@/lib/recovery/engine";
import { readRecoveryNote, requestWithNote } from "@/lib/recovery/note";
import { preferredProposal } from "@/lib/recovery/presentation";
import { REBUILD_CASES } from "../../evals/rebuild/cases";
const base = () => RebuildRequest.parse(REBUILD_CASES.find((c) => c.name === "simple-move")!.request);
const read = (text: string) => readRecoveryNote(text, base());
const input = (text: string): RecoveryInput => {
  const r = read(text);
  expect(r.questions).toEqual([]);
  return {
    request: requestWithNote(base(), r.settings),
    obstacle: r.settings.obstacle ?? "unsure",
    budget: r.settings.starterMinutes ?? 20,
    category: "math",
    useEstimates: false,
    allowOneMove: false,
    memory: emptyMemory(),
  };
};
describe("typed recovery notes", () => {
  it("turns a small amount of time today into a real cap, with all remaining work planned", () => {
    const i = input("I'm stuck and only have twenty minutes tonight.");
    const plan = preferredProposal(recover(i), i.obstacle)!;
    expect(plan).toBeDefined();
    const today = DateTime.fromISO(i.request.now, { zone: i.request.zone }).toISODate();
    const minutesToday = plan.placements
      .filter((p) => DateTime.fromISO(p.start, { zone: i.request.zone }).toISODate() === today)
      .reduce((sum, p) => sum + p.minutes, 0);
    expect(minutesToday).toBeGreaterThan(0);
    expect(minutesToday).toBeLessThanOrEqual(20);
    expect(plan.placements.reduce((sum, p) => sum + p.minutes, 0)).toBe(60);
    expect(proposalProblems(i, plan)).toEqual([]);
  });
  it("makes a busy-until time unavailable, rather than just changing the label", () => {
    const i = input("I'm busy until 8 PM.");
    const until = DateTime.fromISO(i.request.now, { zone: i.request.zone })
      .set({ hour: 20, minute: 0, second: 0, millisecond: 0 })
      .toMillis();
    expect(i.request.fixed.at(-1)!.title).toBe("Unavailable until the time you gave");
    for (const plan of recover(i).proposals) {
      expect(plan.placements.every((p) => Date.parse(p.start) >= until)).toBe(true);
      expect(proposalProblems(i, plan)).toEqual([]);
    }
  });
  it("updates remaining effort from hours or minutes without changing the deadline", () => {
    for (const text of ["I need 90 minutes to finish.", "I have 1.5 hours left.", "I have ninety minutes remaining."]) {
      const i = input(text);
      expect(recover(i).estimate.minutes).toBe(90);
      expect(i.request.deadlines).toEqual(base().deadlines);
      expect(i.request.items[0].due).toBe(base().items[0].due);
      expect(recover(i).proposals.every((p) => p.required === 90)).toBe(true);
    }
  });
  it("does not confuse time left on a task with time available today", () => {
    expect(read("I only have 20 minutes left.").settings).toEqual({ remainingMinutes: 20, obstacle: "underestimated" });
  });
  it("can explicitly keep tonight free and preserve all the work", () => {
    const i = input("I can't study tonight.");
    const midnight = DateTime.fromISO(i.request.now, { zone: i.request.zone })
      .plus({ days: 1 })
      .startOf("day")
      .toMillis();
    expect(recover(i).proposals.length).toBeGreaterThan(0);
    expect(recover(i).proposals.every((p) => p.placements.every((s) => Date.parse(s.start) >= midnight))).toBe(true);
  });
  it("reads a short first-step limit and still schedules the rest", () => {
    const i = input("I'm stuck. Start with five minutes.");
    const p = preferredProposal(recover(i), i.obstacle)!;
    expect(p.placements[0].minutes).toBe(5);
    expect(p.placements.reduce((sum, s) => sum + s.minutes, 0)).toBe(60);
  });
  it("distinguishes a focus limit from a whole-day limit", () => {
    const r = read("I can only do 15 minutes at a time.");
    expect(r.questions).toEqual([]);
    expect(r.settings.starterMinutes).toBe(15);
    expect(r.settings.todayMinutes).toBeUndefined();
  });
  it("resolves tomorrow and relative availability in the request's time zone", () => {
    const r = base();
    const t = readRecoveryNote("I'm free tomorrow at 9 AM.", r);
    expect(t.questions).toEqual([]);
    expect(DateTime.fromISO(t.settings.freeAgainAt!, { zone: r.zone }).toFormat("yyyy-MM-dd HH:mm")).toBe(
      DateTime.fromISO(r.now, { zone: r.zone }).plus({ days: 1 }).toFormat("yyyy-MM-dd") + " 09:00",
    );
    const rel = readRecoveryNote("I'll be free in 30 minutes.", r);
    expect(rel.questions).toEqual([]);
    expect(Date.parse(rel.settings.freeAgainAt!) - Date.parse(r.now)).toBe(30 * 60000);
  });
  it("asks instead of guessing an ambiguous or already-passed time", () => {
    for (const text of ["busy until 8", "free at 2 AM", "free after lunch", "busy until 25:70"])
      expect(read(text).questions.length, text).toBeGreaterThan(0);
  });
  it("asks for one clear availability time rather than silently choosing one", () => {
    for (const text of ["free at 8 PM or 9 PM", "free in 30 minutes or at 8 PM", "not available at 8 PM"])
      expect(read(text).questions.length, text).toBeGreaterThan(0);
  });
  it("treats an explicit free-again time as an interruption without inventing a need for rest", () => {
    expect(read("I'm free at 8 PM").settings.obstacle).toBe("interrupted");
  });
  it("does not suggest rest from a negated feeling", () => {
    expect(read("I'm not tired, I'm stuck.").settings.obstacle).toBe("stuck");
    expect(read("I'm not exhausted.").settings.obstacle).toBeUndefined();
  });
  it("does not silently change a deadline or guess an unsupported day or zone", () => {
    for (const text of ["I'm tired but the deadline changed.", "busy until Friday at 8 PM", "free at 8 PM PST"])
      expect(read(text).questions.length, text).toBeGreaterThan(0);
  });
  it("asks about unknown notes and rejects out-of-range quantities", () => {
    for (const text of [
      "I lost my notebook",
      "I need 900 minutes to finish",
      "I only have 3 minutes",
      "",
      "x".repeat(281),
    ])
      expect(read(text).questions.length, text).toBeGreaterThan(0);
  });
  it("cannot expand loaded availability or alter fixed commitments", () => {
    const original = base(),
      snapshot = JSON.stringify(original);
    const r = requestWithNote(original, read("I'm busy until 8 PM and only have 20 minutes tonight.").settings);
    expect(r.fixed.slice(0, original.fixed.length)).toEqual(original.fixed);
    expect(
      r.open_windows.every((w) =>
        original.open_windows.some(
          (o) => Date.parse(o.start) <= Date.parse(w.start) && Date.parse(w.end) <= Date.parse(o.end),
        ),
      ),
    ).toBe(true);
    expect(r.deadlines).toEqual(original.deadlines);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
  it("cannot manufacture a plan when no complete recovery fits", () => {
    const i = input("I need 90 minutes to finish.");
    i.request.open_windows = [];
    expect(recover(i).proposals).toEqual([]);
  });
  it("rejects DST gaps and repeated local times", () => {
    const r = base();
    r.now = "2026-11-01T00:00:00-04:00";
    expect(readRecoveryNote("free at 1:30 AM", r).questions.join(" ")).toMatch(/clock change/);
    r.now = "2026-03-08T00:00:00-05:00";
    expect(readRecoveryNote("free at 2:30 AM", r).questions.join(" ")).toMatch(/clock change/);
  });
});
