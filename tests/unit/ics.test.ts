import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toIcs } from "@/lib/calendar/ics";
import { buildPlan } from "@/lib/plan/build";
import { planFrom } from "@/lib/plan/session";
import type { SourceMeta, SourceReading } from "@/lib/plan/types";
import sample from "@/lib/demo/sample-week.json";

// "Add to Calendar": the verified plan as an .ics file, checked on the sample week (classes with breaks and an end
// date) and the PHYS161 syllabus (tentative exams).

const ZONE = "America/New_York";
const NOW = new Date("2026-11-03T22:00:00Z");
const unfold = (ics: string) => ics.replace(/\r\n /g, "");
const events = (ics: string) => unfold(ics).split("BEGIN:VEVENT").slice(1);

describe("calendar export", () => {
  const week = sample as unknown as { zone: string; readings: SourceReading[] };
  const s = planFrom(week.readings, { zone: week.zone, answers: [] });
  const ics = toIcs(s.plan, s.sources, NOW);

  it("is a valid calendar: CRLF lines, none over 75 octets, one event per verified class and dated item", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    const classes = s.plan.classes.filter((c) => c.status === "verified" && c.first_date).length;
    const items = s.plan.items.filter((i) => i.status === "verified" && i.date).length;
    expect(events(ics)).toHaveLength(classes + items);
  });

  it("repeats classes weekly until the last day of classes, skipping break days, in the person's zone", () => {
    const cls = events(ics).find((e) => e.includes("RRULE:"))!;
    expect(cls).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=[A-Z,]+;UNTIL=\d{8}T\d{6}Z/);
    expect(cls).toMatch(new RegExp(`DTSTART;TZID=${ZONE}:\\d{8}T\\d{6}`));
    expect(events(ics).some((e) => /EXDATE;TZID=America\/New_York:202611(25|26|27)T/.test(e))).toBe(true);
  });

  it("times exams and deadlines when a time is known, and makes the rest all-day", () => {
    expect(events(ics).some((e) => /DTSTART;TZID=America\/New_York:\d{8}T\d{6}/.test(e) && !e.includes("RRULE"))).toBe(true); // prettier-ignore
    const allDay = events(ics).find((e) => e.includes("DTSTART;VALUE=DATE:"));
    if (allDay) expect(allDay).toMatch(/DTEND;VALUE=DATE:\d{8}/);
  });

  it("marks tentative dates tentative", () => {
    const rec = JSON.parse(readFileSync("evals/recorded/syllabus-phys161-policies.pdf.json", "utf8"));
    const source: SourceMeta = { id: "syl", kind: "syllabus_pdf", label: "PHYS161 syllabus", captured_at: null, added_at: "2026-10-29T09:00:00-04:00" }; // prettier-ignore
    const plan = buildPlan([{ source, pages: rec.pages }], { zone: ZONE });
    const out = events(toIcs(plan, [source], NOW));
    const m2 = out.find((e) => e.includes("Midterm 2"))!;
    expect(m2).toContain("STATUS:TENTATIVE");
    expect(m2).toContain("SUMMARY:PHYS161: Midterm 2 (tentative)");
    expect(m2).toContain("DTSTART;TZID=America/New_York:20261118T130000");
    expect(m2).toContain("DTEND;TZID=America/New_York:20261118T135000");
    expect(out.some((e) => e.includes("Final exam"))).toBe(false); // TBA: no date, so not on the calendar
  });

  it("escapes commas, semicolons, and new lines in text", () => {
    expect(unfold(ics)).not.toMatch(/SUMMARY:[^\r\n]*[^\\][,;]/);
  });
});
