import { DateTime } from "luxon";
import type { RebuildRequest, RebuildResponse } from "@/lib/rebuild/contract";
import { checkResponse, Draft } from "@/lib/rebuild/draft";

// The week the missed-session panel draws, before and after the rebuild. All
// layout is code: which days and hours show, where every block sits, what
// changed. The rendered week is the plan AFTER the diff: a moved item sits at
// its new time, and its old slot keeps a faint ghost.

export type Pastel = "sage" | "powder" | "blush" | "lavender" | "butter";
const PASTELS: Pastel[] = ["sage", "powder", "blush", "lavender", "butter"];

export type Block = {
  key: string;
  /** The plan item's id; null for a class. */
  id: string | null;
  kind: "class" | "session" | "ghost";
  title: string;
  course: string | null;
  color: Pastel | null;
  day: string;
  start: number;
  end: number;
  /** For a ghost: why the slot is empty now. */
  ghost?: "missed" | "moved" | "dropped";
  /** For a session that moved: the reason, as the message says it. */
  reason?: string | null;
  moved?: boolean;
};

export type Marker = { key: string; kind: "deadline" | "now"; title: string; day: string; at: number };
export type Band = { day: string; start: number; end: number };
export type Move = { id: string; title: string; from: Block; to: Block; reason: string | null };

export type Row = { from: number; to: number; px: number; label: string | null };

export type WeekModel = {
  zone: string;
  days: { iso: string; weekday: string; date: string }[];
  rows: Row[];
  height: number;
  before: Block[];
  after: Block[];
  markers: Marker[];
  /** Free time Tomorrow sent: shown only while the agent is finding open time. */
  bands: Band[];
  moves: Move[];
  dropped: Block[];
  counts: { changed: number; unchanged: number; total: number };
  checks: { label: string; ok: boolean }[];
  colorOf: (course: string | null) => Pastel | null;
};

export const HOUR_PX = 48;
export const IDLE_PX = 16;
const FIRST_HOUR = 7;
const LAST_HOUR = 24;

/** "4 PM", "7:30 AM", "11:59 PM", "12 PM". */
export function clock(ms: number, zone: string): string {
  const d = DateTime.fromMillis(ms, { zone });
  return d.toFormat(d.minute ? "h:mm a" : "h a");
}

/** "4–5 PM", "7:30–8:30 AM", "11 AM–12:15 PM". */
export function span(start: number, end: number, zone: string): string {
  const a = DateTime.fromMillis(start, { zone });
  const b = DateTime.fromMillis(end, { zone });
  const short = (d: DateTime) => d.toFormat(d.minute ? "h:mm" : "h");
  return a.toFormat("a") === b.toFormat("a") ? `${short(a)}–${clock(end, zone)}` : `${clock(start, zone)}–${clock(end, zone)}`; // prettier-ignore
}

/** Any "HH:mm" in code's own words (refusals, free-time lists) as 12-hour time. */
export function twelveHour(text: string): string {
  return text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, h: string, m: string) => {
    const hour = Number(h);
    const suffix = hour < 12 ? "AM" : "PM";
    const h12 = hour % 12 || 12;
    return m === "00" ? `${h12} ${suffix}` : `${h12}:${m} ${suffix}`;
  });
}

/** Wall-clock hours since the start of `day` (so the clock-change day still lines up with its hour labels). */
export function hoursInto(ms: number, day: string, zone: string): number {
  const t = DateTime.fromMillis(ms, { zone });
  const days = Math.round(t.startOf("day").diff(DateTime.fromISO(day, { zone }), "days").days);
  return days * 24 + t.hour + t.minute / 60;
}

/** Where a wall-clock hour sits on the compressed axis, in pixels from the top. */
export function yOf(rows: Row[], hours: number): number {
  let y = 0;
  for (const r of rows) {
    if (hours >= r.to) {
      y += r.px;
      continue;
    }
    if (hours > r.from) y += ((hours - r.from) / (r.to - r.from)) * r.px;
    break;
  }
  return Math.round(y);
}

export function buildWeek(req: RebuildRequest, res: RebuildResponse): WeekModel {
  const zone = req.zone;
  const d = new Draft(req);
  const local = (ms: number) => DateTime.fromMillis(ms, { zone });
  const dayOf = (ms: number) => local(ms).toISODate()!;
  const first = local(d.now).startOf("day");
  const days = [0, 1, 2].map((n) => {
    const day = first.plus({ days: n });
    return { iso: day.toISODate()!, weekday: day.toFormat("ccc"), date: day.toFormat("LLL d") };
  });
  const shown = new Set(days.map((x) => x.iso));

  const courses = [...new Set(req.items.map((i) => i.course).filter((c): c is string => !!c))].sort();
  const colorOf = (course: string | null) => (course ? PASTELS[courses.indexOf(course) % PASTELS.length] : null);

  const ms = (iso: string) => Date.parse(iso);
  const classes: Block[] = req.fixed.map((f, n) => ({
    key: `class-${n}`,
    id: null,
    kind: "class",
    title: f.title,
    course: null,
    color: null,
    day: dayOf(ms(f.start)),
    start: ms(f.start),
    end: ms(f.end),
  }));
  const original = (i: RebuildRequest["items"][number]): Block => ({
    key: `item-${i.id}`,
    id: i.id,
    kind: "session",
    title: i.title,
    course: i.course,
    color: colorOf(i.course),
    day: dayOf(ms(i.start)),
    start: ms(i.start),
    end: ms(i.end),
  });
  const before = [...classes, ...req.items.map(original)];

  const diff = new Map(res.diff.map((x) => [x.item_id, x]));
  const after: Block[] = [...classes];
  const moves: Move[] = [];
  const dropped: Block[] = [];
  for (const i of req.items) {
    const was = original(i);
    const x = diff.get(i.id);
    const missed = i.id === req.missed.item_id;
    if (!x || x.action === "keep") {
      // A missed item nothing was decided for still shows where it was missed.
      after.push(missed ? { ...was, key: `ghost-${i.id}`, kind: "ghost", ghost: "missed" } : was);
      continue;
    }
    const ghost: Block = { ...was, key: `ghost-${i.id}`, kind: "ghost", ghost: missed ? "missed" : x.action === "drop" ? "dropped" : "moved" }; // prettier-ignore
    after.push(ghost);
    if (x.action === "drop") {
      dropped.push(ghost);
      continue;
    }
    const to: Block = { ...was, day: dayOf(ms(x.start!)), start: ms(x.start!), end: ms(x.end!), moved: true, reason: x.reason }; // prettier-ignore
    after.push(to);
    moves.push({ id: i.id, title: i.title, from: was, to, reason: x.reason });
  }

  const markers: Marker[] = [
    ...req.deadlines.map((x) => ({ key: `due-${x.id}`, kind: "deadline" as const, title: x.title, day: dayOf(ms(x.due)), at: ms(x.due) })), // prettier-ignore
    { key: "now", kind: "now" as const, title: "Now", day: dayOf(d.now), at: d.now },
  ];
  const bands: Band[] = req.open_windows.map((w) => ({ day: dayOf(ms(w.start)), start: ms(w.start), end: ms(w.end) }));

  // Hours with something in them (before or after, or free time a move could land in) get full height; the rest
  // compress. The same rows serve every phase, so nothing shifts while the week animates.
  const busy = new Set<number>();
  const mark = (day: string, a: number, b: number) => {
    if (!shown.has(day)) return;
    const from = Math.floor(hoursInto(a, day, zone));
    const to = Math.ceil(hoursInto(Math.max(b, a + 60_000), day, zone));
    for (let h = from; h < to; h++) busy.add(h);
  };
  for (const b of [...before, ...after]) mark(b.day, b.start, b.end);
  for (const m of markers) mark(m.day, m.at, m.at + 1);
  for (const b of bands) mark(b.day, b.start, b.end);
  const rows: Row[] = [];
  for (let h = FIRST_HOUR; h < LAST_HOUR; h++) {
    const label = DateTime.fromObject({ hour: h % 24 }).toFormat("h a");
    if (busy.has(h)) rows.push({ from: h, to: h + 1, px: HOUR_PX, label });
    else if (rows.at(-1) && !rows.at(-1)!.label) rows.at(-1)!.to = h + 1;
    else rows.push({ from: h, to: h + 1, px: IDLE_PX, label: null });
  }

  const total = req.items.length + req.fixed.length + req.deadlines.length;
  const changed = res.diff.filter((x) => x.action !== "keep").length;
  const problems = checkResponse(req, res);
  const has = (re: RegExp) => problems.some((p) => re.test(p));
  return {
    zone,
    days,
    rows,
    height: rows.reduce((a, r) => a + r.px, 0),
    before,
    after,
    markers,
    bands,
    moves,
    dropped,
    counts: { changed, unchanged: total - changed, total },
    checks: [
      { label: "After now", ok: !has(/in the past/) },
      { label: "Inside free time", ok: !has(/not free time/) },
      { label: "No overlaps", ok: !has(/not free time|every item/) },
      { label: "Before deadline", ok: !has(/after it's due/) },
    ],
    colorOf,
  };
}

/** Where a block or marker sits: its day column and its top and height in pixels. */
export function placeOf(model: WeekModel, day: string, start: number, end: number) {
  const col = model.days.findIndex((x) => x.iso === day);
  const top = yOf(model.rows, hoursInto(start, day, model.zone));
  const bottom = yOf(model.rows, hoursInto(end, day, model.zone));
  return { col, top, height: Math.max(24, bottom - top) };
}
