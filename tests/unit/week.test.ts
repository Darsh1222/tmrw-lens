import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { buildRequest } from "@/lib/recovery/workspace";
import { emptyMemory, recover, type RecoveryInput } from "@/lib/recovery/engine";
import { beginNextTask, finishNextStep, nextStepKey, sourceForTask } from "@/lib/recovery/next-step";
import {
  calendarDeadlines,
  confirmDeadlineTime,
  confirmedSourceTime,
  savedDeadlines,
  buildWeekRequest,
  courseEvents,
  emptyWeek,
  readWeek,
  saveWeekTask,
  savedTaskBlocks,
  weekEvents,
} from "@/lib/recovery/week";
import { ImportRequest } from "@/lib/tomorrow/contract";
const input = (title = "Worksheet"): RecoveryInput => ({
  request: buildRequest({
    title,
    category: "math",
    minutes: 60,
    zone: "America/New_York",
    now: "2026-11-17T09:00",
    due: "2026-11-25T17:00",
    busy: [],
  }),
  obstacle: "stuck",
  budget: 20,
  useEstimates: false,
  allowOneMove: false,
  category: "math",
  memory: emptyMemory(),
});
const task = (title = "Worksheet") => {
  const i = input(title);
  return beginNextTask(
    i,
    recover(i).proposals.find((p) => p.placements.length > 1)!,
    null,
    false,
  );
};
const courses = ImportRequest.parse({
  version: 1,
  zone: "America/New_York",
  items: [
    {
      lens_id: "class-a",
      title: "MATH101 lecture",
      course: "MATH101",
      evidence: [{ source: "Test schedule", page: null, quote: "MWF 10–11", computed_from: null }],
      kind: "class_block",
      meeting_type: "lecture",
      location: null,
      start: "2026-10-26T10:00:00-04:00",
      end: "2026-10-26T11:00:00-04:00",
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261211T235959Z",
      exdates: ["2026-11-25T10:00:00-05:00"],
    },
  ],
});
describe("durable shared week", () => {
  it("keeps multiple tasks through storage and week navigation without changing their dates", () => {
    const a = task(),
      b = task("Essay");
    const week = readWeek(JSON.stringify(saveWeekTask(saveWeekTask(emptyWeek(), a), b)));
    expect(week.tasks).toHaveLength(2);
    const events = weekEvents(week, "2026-11-16T00:00:00-05:00", "2026-11-30T00:00:00-05:00");
    expect(events.filter((e) => e.taskId === a.id).map((e) => e.start)).toEqual(a.plan.placements.map((p) => p.start));
    expect(weekEvents(week, "2026-11-23T00:00:00-05:00", "2026-11-30T00:00:00-05:00")).toEqual(
      events.filter((e) => DateTime.fromISO(e.start).toMillis() >= Date.parse("2026-11-23T00:00:00-05:00")),
    );
  });
  it("new task proposals avoid all previously saved study sessions", () => {
    const a = task(),
      week = saveWeekTask(emptyWeek(), a),
      b = input("Essay");
    b.request.fixed.push(...savedTaskBlocks(week, b.request.now, b.request.items[0].due!));
    const result = recover(b);
    expect(result.proposals.length).toBeGreaterThan(0);
    for (const p of result.proposals)
      for (const e of p.placements)
        for (const other of a.plan.placements)
          expect(Date.parse(e.start) < Date.parse(other.end) && Date.parse(other.start) < Date.parse(e.end)).toBe(
            false,
          );
  });
  it("keeps reported finished sessions and removes them when completion is undone", () => {
    const a = task(),
      w = saveWeekTask(emptyWeek(), a);
    const next = finishNextStep(a, nextStepKey(a)!, a.plan.placements[0].end);
    const saved = saveWeekTask(w, next);
    expect(saved.tasks[0].completed.reduce((n, p) => n + p.minutes, 0)).toBe(next.completedMinutes);
    expect(
      weekEvents(saved, a.input.request.now, a.input.request.items[0].due!).some((e) => e.kind === "completed"),
    ).toBe(true);
    expect(saveWeekTask(saved, a).tasks[0].completed).toHaveLength(0);
    expect(savedTaskBlocks(saved, a.input.request.now, a.input.request.items[0].due!).length).toBe(
      next.plan.placements.length,
    );
  });
  it("keeps class wall times through DST, term limits and holiday exceptions", () => {
    const events = courseEvents(courses, "2026-10-26T00:00:00-04:00", "2026-11-30T00:00:00-05:00");
    expect(events.find((e) => e.start.startsWith("2026-10-26"))?.start).toContain("10:00:00.000-04:00");
    expect(events.find((e) => e.start.startsWith("2026-11-02"))?.start).toContain("10:00:00.000-05:00");
    expect(events.some((e) => e.start.startsWith("2026-11-25"))).toBe(false);
    expect(courseEvents(courses, "2026-12-14T00:00:00-05:00", "2026-12-21T00:00:00-05:00")).toHaveLength(0);
  });
  it("shows office hours as optional and does not reserve them as regular classes", () => {
    const optional = structuredClone(courses);
    optional.items[0].title = "MATH101 office hours";
    expect(
      courseEvents(optional, "2026-11-16T00:00:00-05:00", "2026-11-23T00:00:00-05:00").every(
        (e) => e.kind === "office",
      ),
    ).toBe(true);
    const req = buildRequest(
      {
        title: "Review",
        category: "math",
        minutes: 60,
        zone: optional.zone,
        now: "2026-11-17T09:00",
        due: "2026-11-23T17:00",
        busy: [],
      },
      optional,
    );
    expect(req.fixed).toHaveLength(0);
  });
  it("keeps saved classes when a task is entered manually without a new import", () => {
    const request = buildWeekRequest(
      {
        title: "Manual essay",
        category: "study",
        minutes: 60,
        zone: courses.zone,
        now: "2026-11-17T09:00",
        due: "2026-11-23T17:00",
        busy: [],
      },
      { ...emptyWeek(), courses },
    );
    expect(request.fixed.some((p) => p.title === "MATH101 lecture")).toBe(true);
    const office = structuredClone(courses);
    office.items[0].title = "MATH101 office hours";
    const reserved = buildWeekRequest(
      {
        title: "Review",
        category: "study",
        minutes: 60,
        zone: office.zone,
        now: "2026-11-17T09:00",
        due: "2026-11-23T17:00",
        busy: [],
      },
      { ...emptyWeek(), courses: office, attendOfficeHours: true },
    );
    expect(reserved.fixed.some((p) => p.title.includes("office hours"))).toBe(true);
  });
  it("flags date-only deadlines and records a user time without changing source evidence", () => {
    const payload = ImportRequest.parse({
      ...courses,
      items: [
        ...courses.items,
        {
          lens_id: "worksheet",
          kind: "deadline",
          title: "Worksheet",
          course: "MATH101",
          date: "2026-11-25",
          start_time: null,
          end_time: null,
          start: null,
          end: null,
          evidence: courses.items[0].evidence,
        },
      ],
    });
    const week = { ...emptyWeek(), courses: payload };
    expect(savedDeadlines(week)[0]).toMatchObject({ dateOnly: true, timeOrigin: "missing", sourceId: "worksheet" });
    const confirmed = confirmDeadlineTime(week, "worksheet", "16:30", "2026-11-17T15:00:00-05:00");
    expect(savedDeadlines(confirmed)[0]).toMatchObject({ dateOnly: false, timeOrigin: "user" });
    expect(DateTime.fromISO(savedDeadlines(confirmed)[0].due).toUTC().toISO()).toBe("2026-11-25T21:30:00.000Z");
    expect(confirmed.courses).toEqual(payload);
    expect(confirmedSourceTime(confirmed, "worksheet")).toBe("16:30");
    expect(() => confirmDeadlineTime(week, "worksheet", "26:30", "2026-11-17T15:00:00-05:00")).toThrow();
    const changed = structuredClone(confirmed);
    const item = changed.courses!.items.find((i) => i.lens_id === "worksheet")!;
    if (item.kind !== "class_block") item.date = "2026-11-26";
    expect(confirmedSourceTime(changed, "worksheet")).toBeNull();
  });
  it("links a course deadline to its original task through source identity", () => {
    const payload = ImportRequest.parse({
      ...courses,
      items: [
        {
          lens_id: "worksheet",
          kind: "deadline",
          title: "Worksheet",
          course: "MATH101",
          date: "2026-11-25",
          start_time: null,
          end_time: null,
          start: null,
          end: null,
          evidence: courses.items[0].evidence,
        },
      ],
    });
    const a = task();
    a.source = sourceForTask(payload, "worksheet");
    const week = saveWeekTask({ ...emptyWeek(), courses: payload }, a);
    const deadlines = savedDeadlines(week);
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]).toMatchObject({ taskId: a.id, sourceId: "worksheet", dateOnly: false, timeOrigin: "user" });
    expect(a.source).toHaveProperty("lensId", "worksheet");
    expect(
      calendarDeadlines(
        { request: a.input.request, plan: a.plan, phase: "active", example: false, completedMinutes: 0, taskId: a.id },
        week,
      ),
    ).toHaveLength(1);
  });
  it("keeps two different task deadlines at the same instant separately linked", () => {
    const a = task(),
      b = task("Essay"),
      week = saveWeekTask(saveWeekTask(emptyWeek(), a), b);
    expect(
      savedDeadlines(week)
        .map((d) => d.taskId)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    expect(new Set(savedDeadlines(week).map((d) => d.due)).size).toBe(1);
  });
  it("isolates examples and ignores corrupt saved data", () => {
    const a = task();
    a.example = true;
    expect(saveWeekTask(emptyWeek(), a).tasks).toHaveLength(0);
    expect(readWeek('{"version":1,"tasks":"bad"}')).toEqual(emptyWeek());
  });
});
