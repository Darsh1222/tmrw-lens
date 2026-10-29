import { describe, expect, it } from "vitest";
import {
  firstMeeting,
  localDate,
  parseDays,
  parseTime,
  resolveDate,
  toInstant,
  weeklyRrule,
  type DateInputs,
} from "@/lib/resolve/dates";

const syllabus: DateInputs = { term_start: "2026-08-31", photo_date: null, added_date: "2026-10-28" };
const photo: DateInputs = { term_start: null, photo_date: "2026-10-28", added_date: "2026-10-28" }; // a Wednesday

const date = (text: string, inputs: DateInputs) => {
  const r = resolveDate(text, inputs);
  return r.ok ? r.date : r;
};

describe("resolveDate", () => {
  it("counts weeks from the week the term starts", () => {
    expect(date("Week 7 Thu", syllabus)).toBe("2026-10-15");
    expect(date("Week 11 Wed", syllabus)).toBe("2026-11-11");
    expect(date("week 1 mon", { ...syllabus, term_start: "2026-09-02" })).toBe("2026-08-31");
  });
  it("needs the term start for week numbers", () => {
    expect(date("Week 7 Thu", { ...syllabus, term_start: null })).toMatchObject({ ok: false, needs: "term_start" });
  });
  it("reads month names and slashes, with the year from the term", () => {
    expect(date("Fri Oct 30", syllabus)).toBe("2026-10-30");
    expect(date("Monday, December 14", syllabus)).toBe("2026-12-14");
    expect(date("11/3", photo)).toBe("2026-11-03");
    expect(date("Jan 15", syllabus)).toBe("2027-01-15");
    expect(date("August 31, 2026", { term_start: null, photo_date: null, added_date: "2026-10-28" })).toBe(
      "2026-08-31",
    );
  });
  it("asks when the weekday and the date disagree", () => {
    const r = resolveDate("Fri Oct 31", syllabus);
    expect(r).toMatchObject({ ok: false, needs: "choice", options: ["2026-10-31", "2026-10-30"] });
    if (!r.ok) expect(r.reason).toBe("Oct 31, 2026 is a Saturday, not a Friday");
  });
  it("places weekdays after the day the photo was taken", () => {
    expect(date("Mon", photo)).toBe("2026-11-02");
    expect(date("Fri", photo)).toBe("2026-10-30");
    expect(date("tomorrow", photo)).toBe("2026-10-29");
    expect(date("Wed", photo)).toMatchObject({ ok: false, needs: "choice", options: ["2026-11-04", "2026-10-28"] });
    expect(date("next Mon", photo)).toMatchObject({ ok: false, needs: "choice" });
  });
  it("won't place a weekday without a photo date", () => {
    expect(date("Wed", syllabus)).toMatchObject({ ok: false, needs: "photo_date" });
  });
  it("rejects what isn't one date", () => {
    expect(date("Oct 26 - Oct 30", syllabus)).toMatchObject({ ok: false, needs: "rewrite" });
    expect(date("before Midterm 1", syllabus)).toMatchObject({ ok: false, needs: "rewrite" });
    expect(date("2/30", syllabus)).toMatchObject({ ok: false, needs: "rewrite" });
  });
});

describe("parseTime", () => {
  it("reads times and ranges", () => {
    expect(parseTime("11:59pm")).toMatchObject({ start: "23:59", end: null });
    expect(parseTime("@ 5pm")).toMatchObject({ start: "17:00" });
    expect(parseTime("8:00am - 10:00am")).toMatchObject({ start: "08:00", end: "10:00" });
    expect(parseTime("1:00-2:15pm")).toMatchObject({ start: "13:00", end: "14:15" });
    expect(parseTime("11-12:15pm")).toMatchObject({ start: "11:00", end: "12:15" });
    expect(parseTime("7 P.M.")).toMatchObject({ start: "19:00" });
    expect(parseTime("17:30")).toMatchObject({ start: "17:30" });
    expect(parseTime("midnight")).toMatchObject({ start: "23:59" });
  });
  it("asks about am or pm rather than guess", () => {
    expect(parseTime("5")).toMatchObject({ ok: false });
    expect(parseTime("11:59")).toMatchObject({ ok: false });
  });
  it("recognizes in class", () => {
    expect(parseTime("in class")).toEqual({ ok: true, kind: "in_class", meeting: null });
    expect(parseTime("in lab")).toEqual({ ok: true, kind: "in_class", meeting: "lab" });
  });
});

describe("classes", () => {
  it("parses Testudo days", () => {
    expect(parseDays("MWF")).toEqual([1, 3, 5]);
    expect(parseDays("TuTh")).toEqual([2, 4]);
    expect(parseDays("TTh")).toEqual([2, 4]);
    expect(parseDays("Mon/Wed")).toEqual([1, 3]);
    expect(parseDays("xyz")).toBeNull();
    expect(weeklyRrule([1, 3, 5])).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });
  it("finds the first meeting on or after the term start", () => {
    expect(firstMeeting([2, 4], "2026-08-31")).toBe("2026-09-01");
    expect(firstMeeting([1, 3, 5], "2026-08-31")).toBe("2026-08-31");
  });
});

describe("toInstant across DST", () => {
  // US clocks go back on Sunday Nov 1, 2026.
  it("uses EDT before and EST after", () => {
    expect(toInstant("2026-10-30", "23:59", "America/New_York")).toBe("2026-10-30T23:59:00-04:00");
    expect(toInstant("2026-11-01", "23:59", "America/New_York")).toBe("2026-11-01T23:59:00-05:00");
    expect(toInstant("2026-11-02", "10:00", "America/New_York")).toBe("2026-11-02T10:00:00-05:00");
  });
  it("keeps the local date for a late-night UTC instant", () => {
    expect(localDate("2026-10-29T02:30:00Z", "America/New_York")).toBe("2026-10-28");
  });
});
