import { z } from "zod";
import { ModelEvidence } from "@/lib/schemas/evidence";

// What Muse Spark returns for each of the four input types, one image (or one
// pasted text) at a time. Dates, days, and times are the words as written
// ("Week 7 Thu", "TuTh", "10am"); code resolves them, never the model.
// Every *_text field must appear inside its evidence quote, which code checks.

const text = (description: string) => z.string().min(1).describe(description);
const maybe = (description: string) => z.string().min(1).nullable().describe(description);

// 1. Testudo weekly schedule: screenshot of the grid or list view, or pasted text.
export const ScheduleClass = z.object({
  course_code: text('Course code as written, e.g. "MATH141"'),
  section: maybe('Section as written, e.g. "0201"'),
  title: maybe("Course title if shown"),
  meeting_type: z.enum(["lecture", "discussion", "lab", "other"]),
  days_text: text('Meeting days as written, e.g. "MWF" or "TuTh"'),
  start_text: text('Start time as written, e.g. "10:00am"'),
  end_text: text('End time as written, e.g. "10:50am"'),
  location: maybe('Building and room as written, e.g. "ESJ 0224"'),
  evidence: ModelEvidence,
});
/** A term boundary as written, with its quote: "Classes begin Monday, August 31, 2026". */
const TermDate = (what: string) =>
  z
    .object({ date_text: text(`${what} as written, e.g. "December 8, 2026"`), evidence: ModelEvidence })
    .nullable()
    .describe(`Only if this page says it: ${what.toLowerCase()}`);

/** "Thanksgiving break: no classes Nov 25-29". Single days with no classes count too. */
const Breaks = z
  .array(
    z.object({
      name: text('What it\'s called as written, e.g. "Thanksgiving break", "No class"'),
      dates_text: text('The dates as written, e.g. "Nov 25-29", "November 25 - November 29", "Wed 11/11"'),
      evidence: ModelEvidence,
    }),
  )
  .describe("Breaks or days with no classes, only if written");

export const ScheduleExtraction = z.object({
  term_text: maybe('Term as written, e.g. "Fall 2026"'),
  term_end: TermDate("Last day of classes"),
  breaks: Breaks,
  view: z
    .enum(["list", "grid", "text"])
    .describe("list if a text list of classes is visible (preferred over reading grid positions)"),
  classes: z.array(ScheduleClass),
});
export type ScheduleExtraction = z.infer<typeof ScheduleExtraction>;

// 2. Syllabus, one PDF page at a time.
export const SyllabusItem = z.object({
  kind: z.enum(["exam", "quiz", "assignment", "project", "reading", "other"]),
  title: text('Title as written, e.g. "Quiz 3"'),
  date_text: maybe(
    'Date as written, e.g. "Oct 30", "10/30", "Week 7 Thu", or relative to another item: "before Midterm 1", "the day after Quiz 3"',
  ),
  time_text: maybe('Time as written, e.g. "11:59pm" or "8:00am - 10:00am", or "in class" if it says so'),
  weight_text: maybe('Grade weight as written, e.g. "15%"'),
  evidence: ModelEvidence,
});
export const SyllabusPageExtraction = z.object({
  course_code: maybe("Course code if this page names it"),
  course_title: maybe("Course title if this page names it"),
  term_start: TermDate("First day of classes"),
  term_end: TermDate("Last day of classes"),
  breaks: Breaks,
  items: z.array(SyllabusItem),
});
export type SyllabusPageExtraction = z.infer<typeof SyllabusPageExtraction>;

// 3 and 4. Whiteboard photo and handwritten notes: free-form, often messy.
const FreeformItem = z.object({
  kind: z.enum(["exam", "quiz", "assignment", "task", "reminder", "other"]),
  title: text("What it is, as written"),
  course_hint: maybe('A course named or abbreviated next to it, e.g. "calc"'),
  date_text: maybe(
    'Date or day as written, e.g. "Fri", "11/3", "today", or relative to another item: "before Exam 2", "the week after the project"',
  ),
  time_text: maybe('Time as written, e.g. "5pm" or "2-3pm", or "in class" if it says so'),
  change_text: maybe('Words saying it changed, as written, e.g. "moved to", "postponed", "extended", "now due"'),
  legible: z.enum(["clear", "unsure"]).describe("unsure if any word or number in the quote is hard to read"),
  evidence: ModelEvidence,
});
export const WhiteboardExtraction = z.object({ items: z.array(FreeformItem) });
export type WhiteboardExtraction = z.infer<typeof WhiteboardExtraction>;

export const NotesExtraction = z.object({
  items: z.array(
    FreeformItem.extend({ crossed_out: z.boolean().describe("true if the line is struck through or checked off") }),
  ),
});
export type NotesExtraction = z.infer<typeof NotesExtraction>;
