import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { csvText, docxText, htmlText, icsReading, pptxText, xlsxText } from "@/lib/files/convert";
import { auditPlan } from "@/lib/plan/audit";
import { buildPlan } from "@/lib/plan/build";
import type { SourceMeta } from "@/lib/plan/types";

// Files that hold their own words become text in code (no vision); a calendar file becomes items in code (no model).

const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))); // prettier-ignore

describe("file conversion", () => {
  it("Word: paragraphs as lines, table rows with their cells", () => {
    const doc = zip({
      "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>MATH141 Calculus II</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Week 7</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Quiz 3 &amp; review, Thu</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`, // prettier-ignore
    });
    expect(docxText(doc)).toBe("MATH141 Calculus II\nWeek 7 | Quiz 3 & review, Thu");
  });

  it("PowerPoint: each slide in order", () => {
    const deck = zip({
      "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Exam 2: Nov 11</a:t></a:r></a:p></p:sld>",
      "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>Welcome</a:t></a:r></a:p></p:sld>",
      "ppt/slides/slide10.xml": "<p:sld><a:p><a:r><a:t>Final: TBA</a:t></a:r></a:p></p:sld>",
    });
    expect(pptxText(deck)).toBe("Slide 1\nWelcome\n\nSlide 2\nExam 2: Nov 11\n\nSlide 10\nFinal: TBA");
  });

  it("Excel: shared strings, and date cells written out as dates (never left as serial numbers)", () => {
    const book = zip({
      "xl/workbook.xml": '<workbook><sheets><sheet name="Schedule" sheetId="1"/></sheets></workbook>',
      "xl/sharedStrings.xml": "<sst><si><t>Item</t></si><si><t>Due</t></si><si><t>Problem Set 6</t></si></sst>",
      "xl/styles.xml": '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>46331</v></c></row></sheetData></worksheet>', // prettier-ignore
    });
    expect(xlsxText(book)).toBe("Schedule\nItem | Due\nProblem Set 6 | Nov 5, 2026");
  });

  it("a saved web page: visible text only, a line per block", () => {
    const html = `<html><head><title>x</title><style>p{}</style></head><body><h1>To do</h1><script>track()</script><ul><li>PS6 <b>due</b> Nov 5 at 11:59pm</li><li>Quiz 4&nbsp;Fri</li></ul></body></html>`; // prettier-ignore
    expect(htmlText(html)).toBe("To do\nPS6 due Nov 5 at 11:59pm\nQuiz 4 Fri");
  });

  it("CSV: rows as lines, quoted commas kept", () => {
    expect(csvText('Week,Date,Due\n7,"Thu, Oct 15","Quiz 3, in class"\n')).toBe("Week | Date | Due\n7 | Thu, Oct 15 | Quiz 3, in class"); // prettier-ignore
  });

  it("a calendar file becomes items in code, exact to the minute, with 0 invented dates", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:MATH141 Exam 2",
      "DTSTART;TZID=America/New_York:20261111T150000",
      "DTEND;TZID=America/New_York:20261111T161500",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:MATH141 Problem Set 6 due",
      "DTSTART;VALUE=DATE:20261105",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:MATH141 Lecture",
      "DTSTART;TZID=America/New_York:20260831T150000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const { reading, note } = icsReading(ics, "America/New_York");
    expect(note).toMatch(/1 repeating event/);
    expect(reading.text).toBe("MATH141 Exam 2: Nov 11, 2026, 3pm-4:15pm\nMATH141 Problem Set 6 due: Nov 5, 2026");
    const source: SourceMeta = { id: "cal", kind: "syllabus_pdf", label: "calendar file", captured_at: null, added_at: "2026-11-03T09:00:00-05:00" }; // prettier-ignore
    const plan = buildPlan([{ source, pages: [reading] }], { zone: "America/New_York" });
    const exam = plan.items.find((i) => i.title === "MATH141 Exam 2")!;
    expect(exam).toMatchObject({ kind: "exam", course: "MATH141", date: { value: "2026-11-11" }, time: { start: "15:00", end: "16:15" }, status: "verified" }); // prettier-ignore
    expect(plan.items.find((i) => /Problem Set 6/.test(i.title))?.date?.value).toBe("2026-11-05");
    expect(auditPlan(plan, [source]).invented).toEqual([]);
  });

  it("says plainly when a file can't be opened", () => {
    expect(() => docxText(new Uint8Array([1, 2, 3]))).toThrow(/couldn't be opened/);
    expect(() => icsReading("BEGIN:VCALENDAR\nEND:VCALENDAR", "America/New_York")).toThrow(/no events/);
  });
});
