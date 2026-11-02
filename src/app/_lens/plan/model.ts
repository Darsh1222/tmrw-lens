import { DateTime } from "luxon";
import type { ClassBlock, Plan, PlanItem, Status } from "@/lib/plan/types";
import { palette, type Pastel } from "../ui";

// The plan as a calendar: which week to show, what's in each day, and where it
// sits on a compressed hour axis. Date-only items (a deadline with no time
// written) are flags in the day's "due" strip, never given a made-up time.

export type Entry = {
  key: string;
  /** The plan item or class this came from, for the evidence drawer. */
  id: string;
  kind: "class" | "item";
  title: string;
  course: string | null;
  tone: Pastel;
  status: Status;
  day: string;
  /** Wall-clock hours from midnight; null for a date-only item. */
  start: number | null;
  end: number | null;
  label: string;
};

export type Row = { from: number; to: number; px: number; label: string | null };

export const HOUR_PX = 48;
const IDLE_PX = 16;

const hours = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
};

/** "4 PM", "7:30 AM". */
export function hourLabel(h: number): string {
  const d = DateTime.fromObject({ hour: Math.floor(h) % 24, minute: Math.round((h % 1) * 60) });
  return d.toFormat(d.minute ? "h:mm a" : "h a");
}

export function rangeLabel(a: number, b: number | null): string {
  if (b === null) return hourLabel(a);
  const short = (h: number) => {
    const d = DateTime.fromObject({ hour: Math.floor(h) % 24, minute: Math.round((h % 1) * 60) });
    return d.toFormat(d.minute ? "h:mm" : "h");
  };
  const same = a < 12 === b < 12;
  return same ? `${short(a)}–${hourLabel(b)}` : `${hourLabel(a)}–${hourLabel(b)}`;
}

const MEETING = { lecture: "lecture", discussion: "discussion", lab: "lab", other: "class" } as const;

function meets(c: ClassBlock, iso: string): boolean {
  const d = DateTime.fromISO(iso);
  if (!c.days.includes(d.weekday as ClassBlock["days"][number])) return false;
  if (c.first_date && iso < c.first_date.value) return false;
  if (c.last_date && iso > c.last_date.value) return false;
  return !c.skip_dates.some((s) => s.date === iso);
}

export function entriesFor(plan: Plan, days: string[]): Entry[] {
  const tone = palette([...plan.items.map((i) => i.course), ...plan.classes.map((c) => c.course)]);
  const skipped = new Set(plan.skipped ?? []);
  const out: Entry[] = [];
  for (const c of plan.classes) {
    if (skipped.has(c.id) || !c.first_date) continue;
    for (const day of days)
      if (meets(c, day))
        out.push({
          key: `${c.id}-${day}`,
          id: c.id,
          kind: "class",
          title: `${c.course} ${MEETING[c.meeting_type]}`,
          course: c.course,
          tone: tone(c.course),
          status: c.status,
          day,
          start: hours(c.start),
          end: hours(c.end),
          label: rangeLabel(hours(c.start), hours(c.end)),
        });
  }
  for (const i of plan.items) {
    if (skipped.has(i.id) || !i.date || !days.includes(i.date.value)) continue;
    const start = i.time ? hours(i.time.start) : null;
    const end = i.time?.end ? hours(i.time.end) : null;
    out.push({
      key: i.id,
      id: i.id,
      kind: "item",
      title: i.title,
      course: i.course,
      tone: tone(i.course),
      status: i.status,
      day: i.date.value,
      start,
      end,
      label: start === null ? "due" : rangeLabel(start, end),
    });
  }
  return out;
}

/** The week to open on: the one with the first upcoming item after the inputs were added, else the first item's. */
export function firstWeek(plan: Plan, today: string): string {
  const dates = plan.items.flatMap((i) => (i.date ? [i.date.value] : [])).sort();
  const pick = dates.find((d) => d >= today) ?? dates[0] ?? plan.classes.find((c) => c.first_date)?.first_date?.value ?? today; // prettier-ignore
  return DateTime.fromISO(pick).startOf("week").toISODate()!;
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, n) => DateTime.fromISO(monday).plus({ days: n }).toISODate()!);
}

/** Full-height hours where something happens, thin gaps where nothing does. */
export function rowsFor(entries: Entry[], first = 8, last = 23): Row[] {
  const busy = new Set<number>();
  for (const e of entries)
    // A day's grid ends at midnight: an 11:59 PM deadline doesn't open a row for the next day.
    if (e.start !== null) for (let h = Math.floor(e.start); h < Math.min(24, Math.ceil(e.end ?? e.start + 0.5)); h++) busy.add(h); // prettier-ignore
  const lo = Math.min(first, ...[...busy]);
  const hi = Math.max(last, ...[...busy].map((h) => h + 1));
  const rows: Row[] = [];
  for (let h = lo; h < hi; h++) {
    if (busy.has(h)) rows.push({ from: h, to: h + 1, px: HOUR_PX, label: hourLabel(h) });
    else if (rows.at(-1) && !rows.at(-1)!.label) rows.at(-1)!.to = h + 1;
    else rows.push({ from: h, to: h + 1, px: IDLE_PX, label: null });
  }
  return rows;
}

export function yOf(rows: Row[], h: number): number {
  let y = 0;
  for (const r of rows) {
    if (h >= r.to) {
      y += r.px;
      continue;
    }
    if (h > r.from) y += ((h - r.from) / (r.to - r.from)) * r.px;
    break;
  }
  return Math.round(y);
}

/** Every week from the first to the last dated thing in the plan, Monday first. */
export function semesterWeeks(plan: Plan): string[] {
  const dates = [
    ...plan.items.flatMap((i) => (i.date ? [i.date.value] : [])),
    ...plan.classes.flatMap((c) => [c.first_date?.value, c.last_date?.value].filter((x): x is string => !!x)),
  ].sort();
  if (!dates.length) return [];
  const out: string[] = [];
  for (let w = DateTime.fromISO(dates[0]).startOf("week"); w.toISODate()! <= dates.at(-1)!; w = w.plus({ weeks: 1 }))
    out.push(w.toISODate()!);
  return out;
}

export const itemsIn = (plan: Plan, days: string[]): PlanItem[] =>
  plan.items.filter((i) => i.date && days.includes(i.date.value) && !(plan.skipped ?? []).includes(i.id));
