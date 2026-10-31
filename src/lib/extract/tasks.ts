import { z } from "zod";
import type { Task } from "@/lib/meta/task";
import { contains } from "@/lib/plan/text";
import type { SourceKind } from "@/lib/schemas/evidence";
import {
  NotesExtraction,
  ScheduleExtraction,
  SyllabusPageExtraction,
  WhiteboardExtraction,
} from "@/lib/schemas/extraction";

// The Muse Spark tasks: one per input type, plus the independent re-read used
// to verify photos. The model only reads; it never converts a date or time.

const RULES = `Rules:
- The quote is the whole line or table row the item comes from, copied exactly as written: same words, abbreviations, numbers, and punctuation. Don't fix typos.
- Every *_text field and the title are copied from inside that item's quote, exactly. Don't convert, complete, or reformat them: "Week 7 Thu" stays "Week 7 Thu", "Fri" stays "Fri", "11/3" stays "11/3". Never add a year, a date, or a time that isn't written.
- A date written relative to another item ("before Midterm 1", "the week after Project 4") is copied as written, words and all. Don't look up the other item's date.
- If something isn't written, use null. Don't infer it.
- box is where the quote is: [x_min, y_min, x_max, y_max] on a 0-1000 grid of the image, origin top-left. For pasted text, box is null.`;

/** Every field the code will resolve must appear in its quote; the model gets one retry if not. */
function fieldsInQuotes(rows: { label: string; quote: string; fields: (string | null)[] }[]): string | null {
  const problems: string[] = [];
  for (const r of rows)
    for (const f of r.fields)
      if (f !== null && !contains(r.quote, f)) problems.push(`${r.label}: "${f}" is not inside its quote "${r.quote}"`);
  return problems.length ? `${problems.join("; ")}. Copy fields from the quote, or widen the quote.` : null;
}

const termRows = (o: { term_start?: TermDate; term_end?: TermDate; breaks: Break[] }) => [
  ...(["term_start", "term_end"] as const).flatMap((k) => {
    const t = o[k];
    return t ? [{ label: k, quote: t.evidence.quote, fields: [t.date_text] }] : [];
  }),
  ...o.breaks.map((b, i) => ({ label: `breaks[${i}]`, quote: b.evidence.quote, fields: [b.dates_text] })),
];
type Break = { dates_text: string; evidence: { quote: string } };
type TermDate = { date_text: string; evidence: { quote: string } } | null;

export const scheduleTask: Task<ScheduleExtraction> = {
  name: "extract_schedule",
  version: 3,
  instructions: `You read a student's weekly class schedule from the University of Maryland's Testudo: a screenshot (grid view, list view, or both) or pasted text. Extract every class meeting: one entry per meeting pattern (a lecture on MWF and a discussion on TuTh are two entries).
If a text list of courses is visible, read from it rather than from positions on the grid. Ignore names, IDs, and anything that isn't a class meeting. If it shows the last day of classes, fill term_end with those words and their quote. If it lists breaks or days with no classes, add each to breaks.
${RULES}`,
  schema: ScheduleExtraction,
  maxOutputTokens: 12_000,
  check: (o) =>
    fieldsInQuotes([
      ...o.classes.map((c, i) => ({
        label: `classes[${i}]`,
        quote: c.evidence.quote,
        fields: [c.days_text, c.start_text, c.end_text],
      })),
      ...termRows(o),
    ]),
};

export const syllabusPageTask: Task<SyllabusPageExtraction> = {
  name: "extract_syllabus_page",
  version: 4,
  instructions: `You read one page of a course syllabus. Extract every dated or due item on this page: exams, quizzes, assignments, projects, readings. Skip grading tables and policies unless they give a date. If the page says when classes begin, fill term_start with those words and their quote; if it says the last day of classes, fill term_end the same way. Add each break or day with no classes it lists (Thanksgiving break, spring break, "no class") to breaks, with its dates as written; these are not items.
${RULES}`,
  schema: SyllabusPageExtraction,
  maxOutputTokens: 12_000,
  check: (o) =>
    fieldsInQuotes([
      ...o.items.map((it, i) => ({
        label: `items[${i}]`,
        quote: it.evidence.quote,
        fields: [it.title, it.date_text, it.time_text],
      })),
      ...termRows(o),
    ]),
};

const FREEFORM = `${RULES}
- course_hint is a course named or abbreviated next to the item, or in a heading above it ("MATH141", "calc", "131"). It doesn't have to be in the quote.
- change_text is the words saying the item changed ("moved to", "postponed", "extended", "now due"), copied from the quote, or null.
- A date written as the heading of the whole board or page isn't an item; skip it.
- legible is "unsure" if any word or number in the quote is hard to make out.`;

const freeformCheck = (o: { items: WhiteboardExtraction["items"] }) =>
  fieldsInQuotes(
    o.items.map((it, i) => ({
      label: `items[${i}]`,
      quote: it.evidence.quote,
      fields: [it.title, it.date_text, it.time_text, it.change_text],
    })),
  );

export const whiteboardTask: Task<WhiteboardExtraction> = {
  name: "extract_whiteboard",
  version: 3,
  instructions: `You read a photo of a classroom whiteboard or a board of notes. Extract every item a student would need to act on or remember: exams, quizzes, assignments, tasks, reminders.
${FREEFORM}`,
  schema: WhiteboardExtraction,
  maxOutputTokens: 8_000,
  check: freeformCheck,
};

export const notesTask: Task<NotesExtraction> = {
  name: "extract_notes",
  version: 3,
  instructions: `You read a photo of a student's handwritten notes or to-do list. Extract every item on it: exams, quizzes, assignments, tasks, reminders.
${FREEFORM}
- crossed_out is true if the line is struck through or checked off. Still extract it.`,
  schema: NotesExtraction,
  maxOutputTokens: 8_000,
  check: freeformCheck,
};

const TASKS: Record<SourceKind, Task<unknown>> = {
  testudo_screenshot: scheduleTask as Task<unknown>,
  testudo_text: scheduleTask as Task<unknown>,
  syllabus_pdf: syllabusPageTask as Task<unknown>,
  whiteboard_photo: whiteboardTask as Task<unknown>,
  notes_photo: notesTask as Task<unknown>,
};

export function taskFor(kind: SourceKind): Task<unknown> {
  return TASKS[kind];
}

export const RereadBatch = z.object({
  reads: z.array(
    z.object({
      crop: z.int().min(1),
      text: z.string().describe("All the text in the crop, exactly as written, lines joined with a space"),
      legible: z.enum(["clear", "unsure"]),
    }),
  ),
});
export type RereadBatch = z.infer<typeof RereadBatch>;

/** The second read: crops only, with no hint of what the first read said, so the two are independent. */
export function rereadTask(count: number): Task<RereadBatch> {
  return {
    name: "reread_crops",
    version: 1,
    instructions: `Each image is a small crop from a photo or a page, labelled "Crop 1", "Crop 2", and so on. For every crop, transcribe all the text in it exactly as written, character for character. Don't fix spelling, expand abbreviations, or add anything. Text cut off at the crop's edge can be left out. If any character is hard to read, give your best reading and set legible to "unsure". Return one entry per crop.`,
    schema: RereadBatch,
    maxOutputTokens: 4_000,
    effort: "minimal",
    check: (o) => {
      const got = new Set(o.reads.map((r) => r.crop));
      const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !got.has(n));
      return missing.length ? `missing crops ${missing.join(", ")}` : null;
    },
  };
}
