import { DateTime } from "luxon";
import type { RebuildRequest } from "@/lib/rebuild/contract";
import type { Proposal } from "./engine";

export type ScheduleSnapshot = {
  request: RebuildRequest;
  plan: Proposal | null;
  previous?: Proposal | null;
  phase: "before" | "preview" | "active" | "done";
  example: boolean;
  completedMinutes: number;
  baseline?: RebuildRequest;
  taskId?: string;
};
export type ScheduleEvent = {
  key: string;
  title: string;
  start: string;
  end: string;
  kind: "fixed" | "other" | "work" | "ghost" | "office" | "completed";
  taskId?: string;
  minutes: number;
  starter?: boolean;
};
export type ScheduleSegment = ScheduleEvent & { day: string; from: number; to: number; lane: number; lanes: number };

/** Read-only projection of the checked working state; it never schedules or invents calendar events. */
export function scheduleEvents(snapshot: ScheduleSnapshot, before = false): ScheduleEvent[] {
  const request = before && snapshot.baseline ? snapshot.baseline : snapshot.request;
  const plan = before ? (snapshot.previous ?? null) : snapshot.plan;
  const events: ScheduleEvent[] = request.fixed.map((f, n) => ({
    ...f,
    key: `fixed-${n}`,
    kind: "fixed",
    minutes: (Date.parse(f.end) - Date.parse(f.start)) / 60000,
  }));
  for (const item of request.items) {
    if (item.id === request.missed.item_id) continue;
    const move = plan?.moved.find((p) => p.itemId === item.id);
    const start = move?.start ?? item.start,
      end = move?.end ?? item.end;
    events.push({
      key: `item-${item.id}`,
      title: item.title,
      start,
      end,
      kind: "other",
      minutes: (Date.parse(end) - Date.parse(start)) / 60000,
    });
  }
  if (plan) {
    for (const [n, p] of plan.placements.entries())
      events.push({ ...p, key: `work-${p.itemId}-${n}`, kind: "work", taskId: snapshot.taskId });
    if (snapshot.example && !before) {
      const source = snapshot.baseline ?? request;
      const missed = source.items.find((i) => i.id === source.missed.item_id)!;
      events.push({
        key: "missed-origin",
        title: `${missed.title} · missed`,
        start: missed.start,
        end: missed.end,
        minutes: (Date.parse(missed.end) - Date.parse(missed.start)) / 60000,
        kind: "ghost",
      });
    }
  } else if (snapshot.example && (before || snapshot.phase !== "done")) {
    const missed = request.items.find((i) => i.id === request.missed.item_id)!;
    events.push({
      key: `work-${missed.id}-0`,
      title: missed.title,
      start: missed.start,
      end: missed.end,
      minutes: (Date.parse(missed.end) - Date.parse(missed.start)) / 60000,
      kind: "work",
    });
  }
  return events;
}

/** Split midnight-spanning events in local civil time, including DST changes. */
export function scheduleSegments(events: ScheduleEvent[], zone: string, shownDays: string[]): ScheduleSegment[] {
  const segments: ScheduleSegment[] = [];
  for (const event of events) {
    const end = DateTime.fromISO(event.end, { zone });
    let start = DateTime.fromISO(event.start, { zone }),
      part = 0;
    while (start < end && part < 16) {
      const day = start.toISODate()!,
        midnight = start.startOf("day").plus({ days: 1 });
      const stop = end < midnight ? end : midnight;
      if (shownDays.includes(day))
        segments.push({
          ...event,
          key: `${event.key}:${part}`,
          day,
          from: start.hour + start.minute / 60,
          to: stop.equals(midnight) ? 24 : stop.hour + stop.minute / 60,
          lane: 0,
          lanes: 1,
        });
      start = stop;
      part++;
    }
  }
  // Minimum readable height is visual only. Resolve those padded collisions without altering any event time.
  for (const day of shownDays) {
    const ordered = segments
      .filter((p) => p.day === day && p.kind !== "ghost")
      .sort((a, b) => a.from - b.from || b.to - a.to || a.key.localeCompare(b.key));
    let cluster: ScheduleSegment[] = [],
      until = -Infinity;
    const place = () => {
      const ends: number[] = [];
      for (const p of cluster) {
        let lane = ends.findIndex((end) => end <= p.from);
        if (lane < 0) lane = ends.length;
        ends[lane] = Math.max(p.to, p.from + 0.96);
        p.lane = lane;
      }
      for (const p of cluster) p.lanes = ends.length;
      cluster = [];
    };
    for (const p of ordered) {
      if (p.from >= until && cluster.length) {
        place();
        until = -Infinity;
      }
      cluster.push(p);
      until = Math.max(until, p.to, p.from + 0.96);
    }
    if (cluster.length) place();
  }
  return segments;
}

export function scheduleDeadlines(snapshot: ScheduleSnapshot) {
  const deadlines = [...snapshot.request.deadlines];
  const missed = snapshot.request.items.find((i) => i.id === snapshot.request.missed.item_id)!;
  if (
    missed.due &&
    !deadlines.some(
      (d) => (d.id === missed.for || d.id === `due-${missed.id}`) && Date.parse(d.due) === Date.parse(missed.due!),
    )
  )
    deadlines.push({ id: `due-${missed.id}`, title: `${missed.title} due`, due: missed.due, course: missed.course });
  return deadlines;
}
