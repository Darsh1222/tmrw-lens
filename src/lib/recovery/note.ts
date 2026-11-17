import { DateTime } from "luxon";
import { z } from "zod";
import { RebuildRequest } from "@/lib/rebuild/contract";
import { Draft } from "@/lib/rebuild/draft";
import { Obstacles } from "./engine";

/** A small, explicit on-device vocabulary. Unclear constraints are questions, never guesses. */
export const RecoveryNoteSettings = z.object({
  obstacle: z.enum(Obstacles).optional(),
  starterMinutes: z.number().int().min(5).max(120).multipleOf(5).optional(),
  remainingMinutes: z.number().int().min(5).max(600).multipleOf(5).optional(),
  todayMinutes: z.number().int().min(5).max(600).multipleOf(5).optional(),
  freeAgainAt: z.iso.datetime({ offset: true }).optional(),
});
export type RecoveryNoteSettings = z.infer<typeof RecoveryNoteSettings>;
export type NoteReading = { settings: RecoveryNoteSettings; understood: string[]; questions: string[] };
const MIN = 60000;
const duration = String.raw`(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?)\b`;
const words: Record<string, number> = {
  five: 5,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fortyfive: 45,
  sixty: 60,
  ninety: 90,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
};
const minutes = (match: RegExpMatchArray) => Number(match[1]) * (/^(hour|hr)/.test(match[2]) ? 60 : 1);

export function readRecoveryNote(raw: string, request: RebuildRequest): NoteReading {
  const out: NoteReading = { settings: {}, understood: [], questions: [] };
  const valid = z.string().trim().min(1).max(280).safeParse(raw);
  if (!valid.success) return { ...out, questions: ["Write a short note, up to 280 characters."] };
  let text = valid.data
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/forty[ -]five/g, "fortyfive");
  text = text.replace(/\b(five|ten|fifteen|twenty|thirty|fortyfive|forty|sixty|ninety|one|two|three|four)\b/g, (s) =>
    String(words[s]),
  );
  const now = DateTime.fromISO(request.now, { zone: request.zone });
  const settings = out.settings;
  // Never infer changes to deadlines, classes, or permissions from a note.
  if (/\b(deadline|due date|due (?:on|at|tomorrow|today|next))\b/.test(text))
    out.questions.push("If the deadline changed, edit it on your task screen first. A note cannot change it.");
  if (/\b(next week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text))
    out.questions.push("For a different day, use your availability settings. Here you can say today or tomorrow.");
  if (/\b(utc|gmt|est|edt|pst|pdt|cst|cdt)\b/.test(text))
    out.questions.push(`Use your schedule's time zone (${request.zone}), without a time-zone abbreviation.`);

  const positive = text.replace(
    /\b(?:not|never)\s+(?:really\s+)?(?:tired|exhausted|stuck|confused|overwhelmed)\b/g,
    "",
  );
  if (/\b(tired|exhausted|overwhelmed|burnt out|burned out|need (?:a )?(?:rest|break))\b/.test(positive))
    settings.obstacle = "tired";
  else if (
    /\b(stuck|confused|can't start|cannot start|don't understand|where to start|procrastinat\w*)\b/.test(positive)
  )
    settings.obstacle = "stuck";
  else if (/\b(interrupted|meeting|shift|practice|appointment|something came up|busy)\b/.test(positive))
    settings.obstacle = "interrupted";
  else if (/\b(underestimated|took longer|more time)\b/.test(positive)) settings.obstacle = "underestimated";

  const remaining =
    text.match(
      new RegExp(
        String.raw`(?:need|have|got|about)\s+(?:about\s+)?${duration}\s*(?:of (?:work|studying)\s*)?(?:left|remaining|to (?:go|finish|complete))`,
      ),
    ) ??
    text.match(
      new RegExp(String.raw`${duration}\s*(?:of (?:work|studying)\s*)?(?:left|remaining|to (?:go|finish|complete))`),
    );
  const limited = text.match(
    new RegExp(
      String.raw`(?:only\s+(?:have|got|get|manage|do|focus for)|(?:have|got)\s+only)\s+(?:about\s+)?${duration}`,
    ),
  );
  const starter = text.match(
    new RegExp(String.raw`(?:start (?:with|for)|focus for|first step (?:of|for))\s+${duration}`),
  );
  for (const [match, key] of [
    [remaining, "remainingMinutes"],
    [limited, /at a time|in one go/.test(text) ? "starterMinutes" : "todayMinutes"],
    [starter, "starterMinutes"],
  ] as const) {
    if (!match || (key === "todayMinutes" && remaining && match.index === remaining.index)) continue;
    const value = minutes(match),
      max = key === "starterMinutes" ? 120 : 600;
    if (!Number.isInteger(value) || value < 5 || value > max || value % 5)
      out.questions.push(
        `Use a multiple of 5 minutes between 5 and ${max} for ${key === "remainingMinutes" ? "remaining work" : key === "todayMinutes" ? "today's time" : "the first step"}.`,
      );
    else settings[key] = value;
  }
  if (
    remaining &&
    limited &&
    /\b(?:left|remaining|to finish)\b/.test(
      limited.input?.slice((limited.index ?? 0) + limited[0].length, (limited.index ?? 0) + limited[0].length + 14) ??
        "",
    )
  )
    delete settings.todayMinutes;
  if (settings.starterMinutes !== undefined || settings.todayMinutes !== undefined) settings.obstacle ??= "stuck";
  if (settings.remainingMinutes !== undefined) settings.obstacle ??= "underestimated";

  const rest =
    /\b(?:no (?:work|studying|study)|can't (?:work|study)|cannot (?:work|study)|(?:keep|take|need|want) (?:the rest of )?(?:today|tonight) (?:off|free))\b/.test(
      text,
    );
  if (rest && /\b(today|tonight)\b/.test(text)) {
    settings.freeAgainAt = now.plus({ days: 1 }).startOf("day").toISO()!;
    settings.obstacle = "tired";
  }
  const relative = text.match(new RegExp(String.raw`(?:free|available)\s+(?:again\s+)?in\s+${duration}`));
  const clock = text.match(
    /\b(?:until|after|(?:free|available)(?: again)?(?: today| tomorrow)?(?: at| from)?)\s+(?:(tomorrow|today)\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/,
  );
  const clockTokens = text.match(/\b(?:\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?|\d{1,2}\s*[ap]\.?m\.?)\b/g) ?? [];
  if (clockTokens.length > 1 || (relative && clockTokens.length > 0))
    out.questions.push("I found more than one availability time. Give one time when you will be free again.");
  if (/\bnot (?:free|available) at\b/.test(text))
    out.questions.push("Tell me when you will be free again, for example ‘busy until 8 PM’.");
  if (relative) {
    const at = now
      .plus({ minutes: minutes(relative) })
      .startOf("minute")
      .plus({ minutes: now.second ? 1 : 0 });
    if (at <= now || at > now.plus({ days: 14 })) out.questions.push("Choose a future time within the next 14 days.");
    else settings.freeAgainAt = at.toISO()!;
  } else if (clock) {
    const hour = Number(clock[2]),
      minute = Number(clock[3] ?? 0),
      period = clock[4]?.replaceAll(".", "");
    if ((!period && !clock[3]) || (period && (hour < 1 || hour > 12)) || hour > 23 || minute > 59) {
      out.questions.push("Is that AM or PM? Try ‘busy until 8 PM’ or ‘free tomorrow at 09:30’.");
    } else {
      const h = period ? (hour % 12) + (period === "pm" ? 12 : 0) : hour;
      const day = /\btomorrow\b/.test(text) ? now.plus({ days: 1 }) : now;
      const at = day.set({ hour: h, minute, second: 0, millisecond: 0 });
      if (at.hour !== h || at.minute !== minute || at.getPossibleOffsets().length !== 1)
        out.questions.push(
          "That local time is skipped or repeated by a clock change. Choose another time in availability settings.",
        );
      else if (at <= now)
        out.questions.push("That time has passed in your schedule. Add ‘tomorrow’ or choose a later time.");
      else settings.freeAgainAt = at.toISO()!;
    }
  } else if (/\b(until|after|free at|free in|available at)\b/.test(text)) {
    out.questions.push("Give a clear time, such as ‘busy until 8 PM’ or ‘free in 30 minutes’.");
  }
  if (settings.todayMinutes !== undefined && /\btomorrow\b/.test(text))
    out.questions.push("The time limit applies to today. Set tomorrow's available hours on your task screen.");
  if (settings.todayMinutes !== undefined && rest)
    out.questions.push("Would you like today off, or a short session today? Choose one.");

  if (settings.freeAgainAt) settings.obstacle ??= "interrupted";
  if (settings.obstacle === "tired") out.understood.push("Look for a plan that gives you the rest of today off.");
  if (settings.obstacle === "stuck") out.understood.push("Try a small first step and still plan the rest of the work.");
  if (settings.obstacle === "interrupted") out.understood.push("Find another time around your existing commitments.");
  if (settings.obstacle === "underestimated") out.understood.push("Plan around the work still needed.");
  if (settings.starterMinutes !== undefined)
    out.understood.push(`Keep the first step at or under ${settings.starterMinutes} minutes.`);
  if (settings.remainingMinutes !== undefined)
    out.understood.push(`Plan all ${settings.remainingMinutes} remaining minutes.`);
  if (settings.todayMinutes !== undefined)
    out.understood.push(`Use at most ${settings.todayMinutes} minutes for this task today. Plan the rest later.`);
  if (settings.freeAgainAt)
    out.understood.push(
      `No sessions before ${DateTime.fromISO(settings.freeAgainAt, { zone: request.zone }).toFormat("ccc, LLL d · h:mm a")} (${request.zone.replaceAll("_", " ")}).`,
    );
  if (!out.understood.length && !out.questions.length)
    out.questions.push(
      "I couldn't turn that into a scheduling change. Choose an option below, or tell me when you're free and how much time you have.",
    );
  return out;
}

/** Restrict a working copy only. The source deadline and every original commitment remain intact. */
export function requestWithNote(raw: RebuildRequest, unchecked: RecoveryNoteSettings): RebuildRequest {
  const original = RebuildRequest.parse(raw),
    settings = RecoveryNoteSettings.parse(unchecked);
  const request = structuredClone(original);
  const task = request.items.find((i) => i.id === request.missed.item_id)!;
  if (settings.remainingMinutes !== undefined)
    task.start = new Date(Date.parse(task.end) - settings.remainingMinutes * MIN).toISOString();
  if (settings.freeAgainAt) {
    if (
      Date.parse(settings.freeAgainAt) <= Date.parse(request.now) ||
      Date.parse(settings.freeAgainAt) - Date.parse(request.now) > 14 * 86400000
    )
      throw new Error("Choose a future time within 14 days.");
    request.fixed.push({ title: "Unavailable until the time you gave", start: request.now, end: settings.freeAgainAt });
  }
  if (settings.todayMinutes !== undefined) {
    const midnight = DateTime.fromISO(request.now, { zone: request.zone }).plus({ days: 1 }).startOf("day").toMillis();
    let left = settings.todayMinutes * MIN;
    const allowed: { start: string; end: string }[] = [];
    for (const w of new Draft(request).free(task.id).sort((a, b) => a.s - b.s)) {
      const s = Math.ceil(Math.max(w.s, Date.parse(request.now)) / (5 * MIN)) * 5 * MIN;
      const e = Math.floor(Math.min(w.e, midnight) / (5 * MIN)) * 5 * MIN;
      const length = Math.min(left, e - s);
      if (length >= 5 * MIN) {
        allowed.push({ start: new Date(s).toISOString(), end: new Date(s + length).toISOString() });
        left -= length;
      }
      if (!left) break;
    }
    request.open_windows = [
      ...allowed,
      ...request.open_windows.flatMap((w) =>
        Date.parse(w.end) <= midnight
          ? []
          : [{ start: new Date(Math.max(Date.parse(w.start), midnight)).toISOString(), end: w.end }],
      ),
    ];
  }
  return RebuildRequest.parse(request);
}
