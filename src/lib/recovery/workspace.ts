import { DateTime } from "luxon";
import { z } from "zod";
import { RebuildRequest } from "@/lib/rebuild/contract";
import { ImportRequest } from "@/lib/tomorrow/contract";
import type { Proposal } from "./engine";

export const WORKSPACE_KEY = "lens_recovery_import_v1";
export const MEMORY_KEY = "lens_recovery_memory_v1";
export const Setup = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(60),
  minutes: z.coerce.number().int().min(5).max(600),
  zone: z
    .string()
    .refine(
      (zone) => zone === "UTC" || Intl.supportedValuesOf("timeZone").includes(zone),
      "Choose a valid IANA time zone.",
    ),
  now: z.string(),
  due: z.string(),
  studyStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  studyEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  sleepStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  sleepEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  busy: z.array(z.object({ title: z.string().min(1).max(200), start: z.string(), end: z.string() })).max(100),
});
export type Setup = z.infer<typeof Setup>;
const iso = (s: string, zone: string) => {
  const t = DateTime.fromISO(s, { zone });
  if (!t.isValid || t.toFormat("yyyy-MM-dd'T'HH:mm") !== s)
    throw new Error("Check the local date and time, including daylight saving changes.");
  // The repeated fall-back hour has two meanings. Require the user to choose an unambiguous time.
  if (t.getPossibleOffsets().length > 1)
    throw new Error("That local time occurs twice when clocks change. Choose a time outside the repeated hour.");
  return t;
};

/** Stable for one recovery event, distinct across tasks created at the same time. */
export function completionKey(request: RebuildRequest): string {
  const task = request.items.find((item) => item.id === request.missed.item_id);
  const source = JSON.stringify([request.now, request.missed.item_id, task?.title, task?.due]);
  let hash = 2166136261;
  for (let n = 0; n < source.length; n++) hash = Math.imul(hash ^ source.charCodeAt(n), 16777619);
  return `done_${Date.parse(request.now)}_${(hash >>> 0).toString(36)}`;
}

/** Explicit defaults are displayed before building a personal request; dates without a time remain a user decision. */
export function buildRequest(raw: Setup, importPayload?: ImportRequest): RebuildRequest {
  const input = Setup.parse(raw);
  const now = iso(input.now, input.zone),
    due = iso(input.due, input.zone);
  if (due <= now || due.diff(now, "days").days > 14)
    throw new Error("Choose a future deadline within the next 14 days.");
  const fixed = input.busy.map((w) => {
    const s = iso(w.start, input.zone),
      e = iso(w.end, input.zone);
    if (e <= s) throw new Error("A busy block must end after it starts.");
    return { title: w.title, start: s.toISO()!, end: e.toISO()! };
  });
  if (importPayload) {
    const payload = ImportRequest.parse(importPayload);
    if (payload.zone !== input.zone) throw new Error("Keep the source time zone when using verified imports.");
    for (const item of payload.items) {
      if (item.kind !== "class_block") {
        // Only timed, duration-bearing events block time. A deadline is not an occupied day.
        if (
          item.kind === "exam" &&
          item.start &&
          item.end &&
          Date.parse(item.end) > now.toMillis() &&
          Date.parse(item.start) < due.toMillis()
        )
          fixed.push({ title: item.title, start: item.start, end: item.end });
        continue;
      }
      const parts: Record<string, string> = Object.fromEntries(
        item.rrule
          .replace(/^RRULE:/, "")
          .split(";")
          .map((x) => x.split("=")),
      );
      if (
        parts.FREQ !== "WEEKLY" ||
        !parts.BYDAY ||
        (parts.INTERVAL && parts.INTERVAL !== "1") ||
        Object.keys(parts).some((k) => !["FREQ", "BYDAY", "UNTIL", "INTERVAL"].includes(k))
      )
        throw new Error("This class recurrence needs review before recovery. Use explicit busy blocks instead.");
      const codes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
      if (parts.BYDAY.split(",").some((day) => !codes.includes(day)))
        throw new Error("Review this class's weekdays before recovery.");
      const first = DateTime.fromISO(item.start, { zone: input.zone }),
        last = parts.UNTIL ? DateTime.fromFormat(parts.UNTIL, "yyyyMMdd'T'HHmmss'Z'", { zone: "UTC" }) : due;
      if (!last.isValid) throw new Error("Review this class's recurrence end date.");
      const endTime = DateTime.fromISO(item.end, { zone: input.zone });
      for (let day = now.startOf("day"); day <= due; day = day.plus({ days: 1 })) {
        if (!parts.BYDAY.split(",").includes(codes[day.weekday - 1])) continue;
        const start = day.set({ hour: first.hour, minute: first.minute });
        let end = day.set({ hour: endTime.hour, minute: endTime.minute });
        if (end <= start) end = end.plus({ days: 1 });
        if (
          start < first ||
          start > last ||
          end <= now ||
          start >= due ||
          item.exdates.some((x) => DateTime.fromISO(x).toMillis() === start.toMillis())
        )
          continue;
        fixed.push({ title: item.title, start: start.toISO()!, end: end.toISO()! });
      }
    }
  }
  const studyStart = input.studyStart ?? "09:00",
    studyEnd = input.studyEnd ?? "21:00";
  const sleepStart = input.sleepStart ?? "23:00",
    sleepEnd = input.sleepEnd ?? "07:00";
  if (studyStart === studyEnd || sleepStart === sleepEnd)
    throw new Error("Daily start and end times must be different.");
  const windows = [];
  for (let day = now.startOf("day"); day <= due; day = day.plus({ days: 1 })) {
    const start = iso(`${day.toISODate()}T${studyStart}`, input.zone);
    let end = iso(`${day.toISODate()}T${studyEnd}`, input.zone);
    if (end <= start) end = iso(`${day.plus({ days: 1 }).toISODate()}T${studyEnd}`, input.zone);
    if (end > now) windows.push({ start: start.toISO()!, end: end.toISO()! });
  }
  const end = now.minus({ minutes: 1 });
  return RebuildRequest.parse({
    version: 1,
    zone: input.zone,
    now: now.toISO(),
    missed: { item_id: "recovery_task", reply: null },
    items: [
      {
        id: "recovery_task",
        title: input.title,
        course: input.category,
        start: end.minus({ minutes: Math.ceil(input.minutes / 5) * 5 }).toISO(),
        end: end.toISO(),
        due: due.toISO(),
        for: null,
        min_minutes: 5,
        status: "missed",
      },
    ],
    fixed,
    deadlines: [],
    open_windows: windows,
    prefs: {
      sleep: { start: sleepStart, end: sleepEnd },
      quiet: null,
      study_time: null,
      study_hours: { start: studyStart, end: studyEnd },
    },
  });
}

/** Preview only: no caller's source object is changed. Applied sessions can be undone in the workspace. */
export function applyProposal(req: RebuildRequest, proposal: Proposal): RebuildRequest["items"] {
  const recovered = req.items
    .filter((i) => i.id !== req.missed.item_id)
    .map((i) => {
      const move = proposal.moved.find((p) => p.itemId === i.id);
      return move ? { ...i, start: move.start, end: move.end } : { ...i };
    });
  const missed = req.items.find((i) => i.id === req.missed.item_id)!;
  return [
    ...recovered,
    ...proposal.placements.map((p, n) => ({
      ...missed,
      id: `${missed.id}_recovery_${n}`,
      start: p.start,
      end: p.end,
      status: "planned" as const,
    })),
  ];
}

export function recoveryCalendar(req: RebuildRequest, proposal: Proposal, stamp: Date): string {
  const utc = (s: string) => DateTime.fromISO(s).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tomorrow Lens//Recovery//EN", "CALSCALE:GREGORIAN"];
  // This export contains recovered work only. Moving events in an external calendar requires its integration.
  proposal.placements.forEach((p, n) =>
    lines.push(
      "BEGIN:VEVENT",
      `UID:${req.missed.item_id}-${Date.parse(p.start)}-${n}@lens-recovery`,
      `DTSTAMP:${utc(stamp.toISOString())}`,
      `DTSTART:${utc(p.start)}`,
      `DTEND:${utc(p.end)}`,
      `SUMMARY:${esc(p.title)}`,
      "DESCRIPTION:Recovery approved in Tomorrow Lens. Check your existing calendar for duplicates.",
      "END:VEVENT",
    ),
  );
  lines.push("END:VCALENDAR");
  // RFC 5545: fold by UTF-8 octets rather than UTF-16 characters.
  return (
    lines
      .map((line) => {
        let out = "",
          count = 0;
        for (const ch of line) {
          const size = new TextEncoder().encode(ch).length;
          if (count + size > 75) {
            out += "\r\n ";
            count = 1;
          }
          out += ch;
          count += size;
        }
        return out;
      })
      .join("\r\n") + "\r\n"
  );
}
