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
export const ScheduleExtraction = z.object({
  term_text: maybe('Term as written, e.g. "Fall 2026"'),
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
  date_text: maybe('Date as written, e.g. "Oct 30", "10/30", or "Week 7 Thu"'),
  time_text: maybe('Time as written, e.g. "11:59pm"'),
  weight_text: maybe('Grade weight as written, e.g. "15%"'),
  evidence: ModelEvidence,
});
export const SyllabusPageExtraction = z.object({
  course_code: maybe("Course code if this page names it"),
  course_title: maybe("Course title if this page names it"),
  term_start_text: maybe('First day of classes if this page states it, e.g. "August 31, 2026"'),
  items: z.array(SyllabusItem),
});
export type SyllabusPageExtraction = z.infer<typeof SyllabusPageExtraction>;

// 3 and 4. Whiteboard photo and handwritten notes: free-form, often messy.
const FreeformItem = z.object({
  kind: z.enum(["exam", "quiz", "assignment", "task", "reminder", "other"]),
  title: text("What it is, as written"),
  course_hint: maybe('A course named or abbreviated next to it, e.g. "calc"'),
  date_text: maybe('Date or day as written, e.g. "Fri" or "11/3"'),
  time_text: maybe("Time as written"),
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
