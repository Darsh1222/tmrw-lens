import { DateTime } from "luxon";
import { auditPlan } from "@/lib/plan/audit";
import type { Plan, SourceMeta } from "@/lib/plan/types";
import { classImport, itemImport, NotSendable, sendable } from "@/lib/tomorrow/contract";

// "Add to Calendar": the plan's verified items as an iCalendar file (RFC 5545), for any calendar app. The same items
// Send would send, after the same audit: weekly classes with their end date and skipped break days, timed exams and
// deadlines in the person's zone, all-day ones for a date with no time, and tentative dates marked tentative. A task
// with no date has nowhere to go on a calendar, so it's left out.

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Lines longer than 75 octets continue on the next line after a space (RFC 5545 3.1), never mid-character. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (bytes(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const local = (date: string, time: string) => `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
const day = (date: string) => date.replaceAll("-", "");

export function toIcs(plan: Plan, sources: SourceMeta[], now: Date): string {
  const audit = auditPlan(plan, sources);
  if (audit.invented.length) throw new NotSendable(`${audit.invented.length} date(s) don't trace to their source`);
  const { classes, items } = sendable(plan);
  const z = plan.zone;
  const stamp = DateTime.fromJSDate(now).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tomorrow Lens//Lens plan//EN", "CALSCALE:GREGORIAN", `X-WR-TIMEZONE:${z}`]; // prettier-ignore
  const proof = (e: { quote: string; computed_from: string | null }[]) =>
    e.map((x) => `"${x.quote}"${x.computed_from ? ` (${x.computed_from})` : ""}`).join("\n");

  for (const c of classes) {
    const imp = classImport(plan, sources, c);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${c.id}@tmrw-lens`,
      `DTSTAMP:${stamp}`,
      `SUMMARY:${esc(imp.title)}`,
      `DTSTART;TZID=${z}:${local(c.first_date!.value, c.start)}`,
      `DTEND;TZID=${z}:${local(c.first_date!.value, c.end)}`,
      `RRULE:${c.rrule.replace(/^RRULE:/, "")}`,
      ...c.skip_dates.map((s) => `EXDATE;TZID=${z}:${local(s.date, c.start)}`),
      ...(c.location ? [`LOCATION:${esc(c.location)}`] : []),
      `DESCRIPTION:${esc(`${c.marker ? `${c.marker}\n` : ""}From Lens. ${proof(imp.evidence)}`)}`,
      "END:VEVENT",
    );
  }
  for (const i of items) {
    if (!i.date) continue;
    const imp = itemImport(plan, sources, i);
    const d = i.date.value;
    const when = i.time
      ? [`DTSTART;TZID=${z}:${local(d, i.time.start)}`, ...(i.time.end ? [`DTEND;TZID=${z}:${local(d, i.time.end)}`] : [])] // prettier-ignore
      : [`DTSTART;VALUE=DATE:${day(d)}`, `DTEND;VALUE=DATE:${day(DateTime.fromISO(d).plus({ days: 1 }).toISODate()!)}`]; // prettier-ignore
    lines.push(
      "BEGIN:VEVENT",
      `UID:${i.id}@tmrw-lens`,
      `DTSTAMP:${stamp}`,
      `SUMMARY:${esc(`${i.course ? `${i.course}: ` : ""}${imp.title}${i.tentative ? " (tentative)" : ""}`)}`,
      ...when,
      ...(i.tentative ? ["STATUS:TENTATIVE"] : []),
      `DESCRIPTION:${esc(`${i.tentative ? `The syllabus says "${i.tentative.text}".\n` : ""}From Lens. ${proof(imp.evidence)}`)}`, // prettier-ignore
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
