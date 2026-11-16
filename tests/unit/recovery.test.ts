import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { REBUILD_CASES } from "../../evals/rebuild/cases";
import { RebuildRequest } from "@/lib/rebuild/contract";
import {
  emptyMemory,
  estimateEffort,
  proposalProblems,
  recover,
  suggestObstacle,
  RecoveryInput,
  type RecoveryInput as Input,
} from "@/lib/recovery/engine";
import { applyProposal, buildRequest, recoveryCalendar } from "@/lib/recovery/workspace";
import { ImportRequest } from "@/lib/tomorrow/contract";
const input = (name = "simple-move"): Input => ({
  request: RebuildRequest.parse(REBUILD_CASES.find((c) => c.name === name)!.request),
  obstacle: "stuck",
  budget: 20,
  category: "math",
  useEstimates: false,
  allowOneMove: false,
  memory: emptyMemory(),
});

describe("recovery planning", () => {
  it("accounts for the entire task in every option and changes no input", () => {
    const i = input(),
      before = JSON.stringify(i);
    const r = recover(i);
    expect(r.proposals.length).toBeGreaterThan(1);
    for (const p of r.proposals) {
      expect(p.placements.reduce((n, p) => n + p.minutes, 0)).toBe(r.estimate.minutes);
      expect(p.remaining).toBe(0);
      expect(proposalProblems(i, p)).toEqual([]);
      expect(p.moved).toHaveLength(0);
    }
    expect(JSON.stringify(i)).toBe(before);
  });
  it("plans a small first action and the full remainder, with a real break", () => {
    const i = input();
    const p = recover(i).proposals.find((p) => p.id === "starter")!;
    expect(p).toBeDefined();
    expect(p.placements[0].minutes).toBeLessThanOrEqual(20);
    expect(p.placements[0].starter).toBe(true);
    expect(Date.parse(p.placements[1].start) - Date.parse(p.placements[0].end)).toBeGreaterThanOrEqual(10 * 60000);
  });
  it("does not pretend that no available time is a complete plan", () => {
    const i = input();
    i.request.open_windows = [];
    // Other tasks are not silently dropped to manufacture room.
    const r = recover(i);
    expect(r.proposals).toEqual([]);
    expect(r.shortfallMinutes).toBe(r.estimate.minutes);
    expect(r.message).toMatch(/Nothing has been dropped/);
  });
  it("protects today's remainder in the tomorrow option", () => {
    const i = input();
    const p = recover(i).proposals.find((p) => p.id === "tomorrow")!;
    const tomorrow = DateTime.fromISO(i.request.now, { zone: i.request.zone })
      .plus({ days: 1 })
      .startOf("day")
      .toMillis();
    expect(p).toBeDefined();
    expect(p.placements.every((s) => Date.parse(s.start) >= tomorrow)).toBe(true);
  });
  it("never shortens another flexible task and requires opt-in to move it", () => {
    const i = input("make-room");
    i.allowOneMove = true;
    const p = recover(i).proposals.find((p) => p.id === "make-room");
    expect(p).toBeDefined();
    expect(p!.moved).toHaveLength(1);
    expect(proposalProblems(i, p!)).toEqual([]);
    expect(proposalProblems({ ...i, allowOneMove: false }, p!)).toContain("Too many other commitments changed.");
  });
  it("rejects tampered overlap, missing work, and deadline violations", () => {
    const i = input();
    const p = recover(i).proposals[0];
    const missing = {
      ...p,
      placements: p.placements.map((s) => ({
        ...s,
        minutes: s.minutes - 5,
        end: new Date(Date.parse(s.end) - 5 * 60000).toISOString(),
      })),
    };
    expect(proposalProblems(i, missing)).toContain("Some required work is missing.");
    const late = {
      ...p,
      placements: p.placements.map((s) => ({
        ...s,
        start: "2026-11-05T10:00:00-05:00",
        end: "2026-11-05T11:00:00-05:00",
      })),
    };
    expect(proposalProblems(i, late).length).toBeGreaterThan(0);
    const overlap = { ...p, placements: [...p.placements, ...p.placements] };
    expect(proposalProblems(i, overlap)).toContain("Sessions overlap.");
  });
  it("emits valid options across every supported recorded scenario", () => {
    let count = 0;
    for (const c of REBUILD_CASES) {
      const i = { ...input(), request: RebuildRequest.parse(c.request), allowOneMove: true };
      if (!RecoveryInput.safeParse(i).success) continue;
      for (const p of recover(i).proposals) {
        expect(proposalProblems(i, p), c.name).toEqual([]);
        count++;
      }
    }
    expect(count).toBeGreaterThan(30);
  });
  it("rejects inverted windows and unbounded horizons before scheduling", () => {
    const i = input();
    i.request.open_windows = [{ start: "2026-11-05T12:00:00Z", end: "2026-11-05T11:00:00Z" }];
    expect(() => recover(i)).toThrow();
    const far = input();
    far.request.items[0].due = "2030-01-01T00:00:00Z";
    expect(() => recover(far)).toThrow();
  });
  it("exports recovery only and applies to a reversible copy", () => {
    const i = input(),
      source = JSON.stringify(i.request);
    const p = recover(i).proposals[0];
    const applied = applyProposal(i.request, p);
    expect(applied.filter((i) => i.id.includes("_recovery_")).length).toBe(p.placements.length);
    expect(JSON.stringify(i.request)).toBe(source);
    const ics = recoveryCalendar(i.request, p, new Date("2026-11-04T20:00:00Z"));
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(p.placements.length);
    expect(ics).toContain("DTSTART:");
    expect(ics).not.toContain("undefined");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("recovery preference boundaries", () => {
  it("honors an explicit 9 PM finish limit and rechecks it before apply", () => {
    const i = input();
    i.request.open_windows = [{ start: "2026-11-04T21:00:00-05:00", end: "2026-11-04T22:00:00-05:00" }];
    const p = recover(i).proposals[0];
    expect(p).toBeDefined();
    i.memory.preferDaytime = true;
    expect(recover(i).proposals).toEqual([]);
    expect(proposalProblems(i, p)).toContain("Outside the explicit daytime preference.");
  });
  it("rechecks the first-step budget", () => {
    const i = input();
    const p = recover(i).proposals.find((p) => p.id === "starter")!;
    expect(proposalProblems({ ...i, budget: 5 }, p)).toContain("The first step exceeds its budget.");
  });
  it("rounds fractional-block remaining effort up rather than discarding work", () => {
    const i = input();
    const m = i.request.items.find((x) => x.id === i.request.missed.item_id)!;
    m.start = new Date(Date.parse(m.end) - 48 * 60000).toISOString();
    const r = recover(i);
    expect(r.estimate.minutes).toBe(50);
    for (const p of r.proposals) expect(p.placements.reduce((n, p) => n + p.minutes, 0)).toBe(50);
  });
});

describe("transparent learning", () => {
  it("requires opt-in and three category-matched records", () => {
    const m = emptyMemory();
    m.history = [1, 2, 3].map((n) => ({
      id: String(n),
      category: "math",
      estimated: 60,
      actual: 90,
      at: "2026-11-01T00:00:00Z",
    }));
    expect(estimateEffort(60, "math", m, true).minutes).toBe(90);
    expect(estimateEffort(60, "math", m, false).minutes).toBe(60);
    expect(estimateEffort(60, "essay", m, true).minutes).toBe(60);
    m.history.pop();
    expect(estimateEffort(60, "math", m, true).used).toBe(false);
  });
  it("caps outlier effects and retains every estimated minute in the plan", () => {
    const i = input();
    i.useEstimates = true;
    i.memory.history = [1, 2, 3].map((n) => ({
      id: String(n),
      category: "math",
      estimated: 60,
      actual: 1000,
      at: "2026-11-01T00:00:00Z",
    }));
    const r = recover(i);
    expect(r.estimate.minutes).toBe(120);
    for (const p of r.proposals) expect(p.placements.reduce((n, p) => n + p.minutes, 0)).toBe(120);
  });
  it("does not erase time windows after a rejection", () => {
    const i = input();
    const before = recover(i);
    i.memory.rejected = [{ id: "r", hour: 19, reason: "not a good time" }];
    const after = recover(i);
    expect(after.availableMinutes).toBe(before.availableMinutes);
  });
  it("leaves ambiguous and negated obstacle language unspecified", () => {
    expect(suggestObstacle("not tired, just busy")).toBe("unsure");
    expect(suggestObstacle("I don't know")).toBe("unsure");
    expect(suggestObstacle("I'm exhausted and have 20 minutes")).toBe("tired");
    expect(suggestObstacle("I'm stuck")).toBe("stuck");
  });
});

describe("personal and verified import setup", () => {
  const setup = () => ({
    title: "Essay",
    category: "writing",
    minutes: 60,
    zone: "America/New_York",
    now: "2026-11-16T12:00",
    due: "2026-11-18T17:00",
    busy: [],
  });
  it("creates a real local request and refuses unspecified or past deadlines", () => {
    const r = buildRequest(setup());
    expect(r.fixed).toHaveLength(0);
    expect(r.open_windows).toHaveLength(3);
    expect(r.prefs?.sleep).toEqual({ start: "23:00", end: "07:00" });
    expect(() => buildRequest({ ...setup(), due: "2026-11-15T12:00" })).toThrow();
    expect(() => buildRequest({ ...setup(), due: "" })).toThrow();
  });
  it("refuses nonexistent and ambiguous local times", () => {
    expect(() => buildRequest({ ...setup(), now: "2026-03-08T02:30", due: "2026-03-10T12:00" })).toThrow(/daylight/);
    expect(() => buildRequest({ ...setup(), now: "2026-11-01T01:30", due: "2026-11-03T12:00" })).toThrow(/twice/);
  });
  it("expands only confirmed recurrence weekdays and honors exceptions", () => {
    const payload = ImportRequest.parse({
      version: 1,
      zone: "America/New_York",
      items: [
        {
          lens_id: "class1",
          title: "Math",
          course: "MATH",
          evidence: [{ source: "syllabus", page: 1, quote: "MWF 10-11", computed_from: null }],
          kind: "class_block",
          meeting_type: "lecture",
          location: null,
          start: "2026-11-02T10:00:00-05:00",
          end: "2026-11-02T11:00:00-05:00",
          rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261201T235959Z",
          exdates: ["2026-11-18T10:00:00-05:00"],
        },
      ],
    });
    const r = buildRequest({ ...setup(), now: "2026-11-16T09:00" }, payload);
    expect(r.fixed).toHaveLength(1);
    expect(DateTime.fromISO(r.fixed[0].start).toISODate()).toBe("2026-11-16");
    payload.items[0] = {
      ...payload.items[0],
      kind: "class_block",
      meeting_type: "lecture",
      location: null,
      start: "2026-11-02T10:00:00-05:00",
      end: "2026-11-02T11:00:00-05:00",
      rrule: "FREQ=WEEKLY;BYDAY=MO;INTERVAL=2",
      exdates: [],
    };
    expect(() => buildRequest(setup(), payload)).toThrow(/recurrence/);
  });
});
