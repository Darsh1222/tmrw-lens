import { z } from "zod";
import { DateTime } from "luxon";
import { ImportRequest } from "@/lib/tomorrow/contract";
import { NextTask, taskDeadline } from "./next-step";
import { buildRequest, type Setup } from "./workspace";
import { scheduleDeadlines, type ScheduleSnapshot, type ScheduleEvent } from "./schedule";

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
  deadlineTimes: z
    .record(
      z.string(),
      z.object({
        date: z.iso.date(),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        confirmedAt: z.iso.datetime({ offset: true }),
      }),
    )
    .default({}),
});
export type SavedWeek = z.infer<typeof SavedWeek>;
export const emptyWeek = (): SavedWeek => ({
  version: 1,
  courses: null,
  tasks: [],
  attendOfficeHours: false,
  deadlineTimes: {},
});
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
export type CalendarDeadline = {
  id: string;
  title: string;
  due: string;
  dateOnly: boolean;
  taskId?: string;
  currentTask?: boolean;
  sourceId?: string;
  timeOrigin: "source" | "user" | "missing";
  evidence: { source: string; page: number | null; quote: string; computed_from: string | null }[];
};
export function savedDeadlines(week: SavedWeek): CalendarDeadline[] {
  const deadlines: CalendarDeadline[] = [];
  for (const item of week.courses?.items ?? []) {
    if (item.kind === "class_block" || !item.date || officeHours(item.title)) continue;
    const linked = week.tasks.find(
      ({ task }) =>
        task.source?.lensId === item.lens_id ||
        (task.source?.title === item.title &&
          task.source?.date === item.date &&
          task.source.evidence.some((a) => item.evidence.some((b) => a.source === b.source && a.quote === b.quote))),
    )?.task;
    const taskDue = linked && taskDeadline(linked);
    const confirmsSameDay =
      taskDue && DateTime.fromISO(taskDue, { zone: week.courses!.zone }).toISODate() === item.date;
    const confirmed = confirmedSourceTime(week, item.lens_id);
    const chosen =
      confirmed ?? (confirmsSameDay ? DateTime.fromISO(taskDue, { zone: week.courses!.zone }).toFormat("HH:mm") : null);
    const time = item.start_time ?? chosen;
    deadlines.push({
      id: `source-${item.lens_id}`,
      title: item.title,
      due: time
        ? DateTime.fromISO(`${item.date}T${time}`, { zone: week.courses!.zone }).toISO()!
        : DateTime.fromISO(item.date, { zone: week.courses!.zone }).endOf("day").toISO()!,
      dateOnly: !time,
      timeOrigin: item.start_time ? "source" : time ? "user" : "missing",
      taskId: linked?.id,
      sourceId: item.lens_id,
      evidence: item.evidence,
    });
  }
  for (const { task } of week.tasks) {
    const due = taskDeadline(task),
      item = task.input.request.items.find((i) => i.id === task.input.request.missed.item_id)!;
    if (due && !deadlines.some((d) => d.taskId === task.id && Date.parse(d.due) === Date.parse(due)))
      deadlines.push({
        id: `task-${task.id}`,
        title: item.title,
        due,
        dateOnly: false,
        taskId: task.id,
        timeOrigin: "user",
        evidence: task.source?.evidence ?? [],
      });
  }
  return deadlines;
}
/** Confirm a date-only deadline without rewriting the source's words or changing a saved task. */
export function confirmDeadlineTime(week: SavedWeek, sourceId: string, time: string, at: string): SavedWeek {
  const item = week.courses?.items.find((i) => i.lens_id === sourceId);
  if (!item || item.kind === "class_block" || !item.date || item.start_time)
    throw new Error("Review the original deadline before setting a time.");
  const moment = DateTime.fromISO(`${item.date}T${time}`, { zone: week.courses!.zone });
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    !moment.isValid ||
    moment.toFormat("HH:mm") !== time ||
    moment.getPossibleOffsets().length !== 1
  )
    throw new Error("Choose an unambiguous valid local time.");
  return SavedWeek.parse({
    ...week,
    deadlineTimes: { ...week.deadlineTimes, [sourceId]: { date: item.date, time, confirmedAt: at } },
  });
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

export function calendarDeadlines(snapshot: ScheduleSnapshot | null, week: SavedWeek): CalendarDeadline[] {
  const deadlines = snapshot?.example ? [] : savedDeadlines(week);
  if (!snapshot) return deadlines;
  for (const d of scheduleDeadlines(snapshot)) {
    const related = snapshot.request.items.find((i) => i.for === d.id || `due-${i.id}` === d.id);
    const taskId = related?.id === snapshot.request.missed.item_id ? snapshot.taskId : undefined;
    if (
      deadlines.some((x) =>
        taskId ? x.taskId === taskId && Date.parse(x.due) === Date.parse(d.due) : x.id === `request-${d.id}`,
      )
    )
      continue;
    deadlines.push({
      id: `request-${d.id}`,
      title: d.title.replace(/ due$/, ""),
      due: d.due,
      dateOnly: false,
      taskId,
      timeOrigin: "user",
      currentTask: related?.id === snapshot.request.missed.item_id,
      evidence: [],
    });
  }
  return deadlines;
}

export function confirmedSourceTime(week: SavedWeek, sourceId: string): string | null {
  const item = week.courses?.items.find((i) => i.lens_id === sourceId),
    confirmation = week.deadlineTimes[sourceId];
  return item && item.kind !== "class_block" && confirmation?.date === item.date ? confirmation.time : null;
}
