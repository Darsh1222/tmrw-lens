import { z } from "zod";
import { DateTime } from "luxon";
import { ImportRequest } from "@/lib/tomorrow/contract";
import { NextTask, taskDeadline } from "./next-step";
import { buildRequest, type Setup } from "./workspace";
import { type ScheduleEvent } from "./schedule";

import { officeHours } from "./meeting";
export { officeHours } from "./meeting";
export const WEEK_KEY = "lens_saved_week_v1";
const Completed = z.object({
  key: z.string(),
  title: z.string(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  minutes: z.number().positive(),
});
export const SavedWeek = z.object({
  version: z.literal(1),
  courses: ImportRequest.nullable(),
  tasks: z.array(z.object({ task: NextTask, completed: z.array(Completed).max(100) })).max(100),
  attendOfficeHours: z.boolean(),
});
export type SavedWeek = z.infer<typeof SavedWeek>;
export const emptyWeek = (): SavedWeek => ({ version: 1, courses: null, tasks: [], attendOfficeHours: false });
export function readWeek(raw: string | null): SavedWeek {
  try {
    return SavedWeek.parse(JSON.parse(raw ?? "null"));
  } catch {
    return emptyWeek();
  }
}
export function saveWeekTask(week: SavedWeek, task: NextTask): SavedWeek {
  if (task.example) return week;
  const prior = week.tasks.find((x) => x.task.id === task.id);
  const completed = [...(prior?.completed ?? [])];
  if (prior && task.completedMinutes > prior.task.completedMinutes) {
    const current = new Set(task.plan.placements.map((p) => `${p.start}:${p.end}`));
    for (const p of prior.task.plan.placements) {
      if (!current.has(`${p.start}:${p.end}`)) completed.push({ ...p, key: `${task.id}:${p.start}` });
    }
  }
  // Undo removes the corresponding reported completion from the visible history too.
  while (completed.reduce((n, p) => n + p.minutes, 0) > task.completedMinutes) completed.pop();
  return SavedWeek.parse({ ...week, tasks: [...week.tasks.filter((x) => x.task.id !== task.id), { task, completed }] });
}

/** Expand reviewed recurring classes in civil time, respecting start/end dates and exceptions. */
export function courseEvents(courses: ImportRequest | null, from: string, to: string): ScheduleEvent[] {
  if (!courses) return [];
  const events: ScheduleEvent[] = [];
  const codes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  for (const item of courses.items) {
    if (item.kind !== "class_block") {
      if (item.start && item.end && Date.parse(item.end) > Date.parse(from) && Date.parse(item.start) < Date.parse(to))
        events.push({
          key: `course-${item.lens_id}`,
          title: item.title,
          start: item.start,
          end: item.end,
          kind: officeHours(item.title) ? "office" : "fixed",
          minutes: (Date.parse(item.end) - Date.parse(item.start)) / 60000,
        });
      continue;
    }
    const parts = Object.fromEntries(
      item.rrule
        .replace(/^RRULE:/, "")
        .split(";")
        .map((p) => p.split("=")),
    );
    if (parts.FREQ !== "WEEKLY" || !parts.BYDAY || (parts.INTERVAL && parts.INTERVAL !== "1")) continue;
    const first = DateTime.fromISO(item.start, { zone: courses.zone });
    const endClock = DateTime.fromISO(item.end, { zone: courses.zone });
    const until = parts.UNTIL
      ? DateTime.fromFormat(parts.UNTIL, "yyyyMMdd'T'HHmmss'Z'", { zone: "UTC" }).toMillis()
      : Infinity;
    const last = DateTime.fromISO(to, { zone: courses.zone });
    let count = 0;
    for (
      let day = DateTime.fromISO(from, { zone: courses.zone }).startOf("day");
      day < last && count++ < 370;
      day = day.plus({ days: 1 })
    ) {
      if (!parts.BYDAY.split(",").includes(codes[day.weekday - 1])) continue;
      const start = day.set({ hour: first.hour, minute: first.minute });
      let end = day.set({ hour: endClock.hour, minute: endClock.minute });
      if (end <= start) end = end.plus({ days: 1 });
      if (start < first || start.toMillis() > until || item.exdates.some((d) => Date.parse(d) === start.toMillis()))
        continue;
      if (end.toMillis() <= Date.parse(from) || start.toMillis() >= Date.parse(to)) continue;
      events.push({
        key: `course-${item.lens_id}-${day.toISODate()}`,
        title: item.title,
        start: start.toISO()!,
        end: end.toISO()!,
        kind: officeHours(item.title) ? "office" : "fixed",
        minutes: end.diff(start, "minutes").minutes,
      });
    }
  }
  return events;
}
export function weekEvents(week: SavedWeek, from: string, to: string, omitTask?: string): ScheduleEvent[] {
  const events = courseEvents(week.courses, from, to);
  for (const { task, completed } of week.tasks) {
    if (task.id !== omitTask)
      for (const [n, p] of task.plan.placements.entries())
        events.push({ ...p, key: `saved-${task.id}-${n}`, kind: "other", taskId: task.id });
    for (const p of completed) events.push({ ...p, key: `finished-${p.key}`, kind: "completed", taskId: task.id });
  }
  return events.filter((p) => Date.parse(p.end) > Date.parse(from) && Date.parse(p.start) < Date.parse(to));
}
export function savedDeadlines(week: SavedWeek) {
  const deadlines =
    week.courses?.items.flatMap((i) =>
      i.kind !== "class_block" && i.date && !officeHours(i.title)
        ? [
            {
              id: `source-${i.lens_id}`,
              title: i.title,
              due: i.start ?? DateTime.fromISO(i.date, { zone: week.courses!.zone }).endOf("day").toISO()!,
              dateOnly: !i.start_time,
            },
          ]
        : [],
    ) ?? [];
  for (const { task } of week.tasks) {
    const due = taskDeadline(task);
    const item = task.input.request.items.find((i) => i.id === task.input.request.missed.item_id)!;
    if (due && !deadlines.some((d) => d.title === item.title && Date.parse(d.due) === Date.parse(due)))
      deadlines.push({ id: task.id, title: item.title, due, dateOnly: false });
  }
  return deadlines;
}
/** Saved tasks are protected commitments. Replanning one task never displaces another silently. */
export function savedTaskBlocks(week: SavedWeek, from: string, to: string, omitTask?: string) {
  return weekEvents({ ...week, courses: null }, from, to, omitTask)
    .filter((e) => e.kind !== "completed")
    .map((p) => ({ title: p.title, start: p.start, end: p.end }));
}

/** Manual task entry still uses the saved course basics; changing task input never discards classes. */
export function buildWeekRequest(setup: Setup, week: SavedWeek, pending?: ImportRequest) {
  const courses = pending ?? week.courses;
  const request = buildRequest({ ...setup, zone: courses?.zone ?? setup.zone }, courses ?? undefined);
  const due = request.items[0].due!;
  request.fixed.push(...savedTaskBlocks(week, request.now, due));
  if (week.attendOfficeHours)
    request.fixed.push(
      ...courseEvents(courses, request.now, due)
        .filter((p) => p.kind === "office")
        .map(({ title, start, end }) => ({ title, start, end })),
    );
  return request;
}
