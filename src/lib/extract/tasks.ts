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
  version: 6,
  // Minimal reasoning: half the thinking tokens, the same accuracy on the evals; a failed check retries at low.
  effort: "minimal",
  instructions: `You read a student's weekly class schedule from the University of Maryland's Testudo: a screenshot (grid view, list view, or both) or pasted text. Extract every class meeting: one entry per meeting pattern (a lecture on MWF and a discussion on TuTh are two entries).
If a text list of courses is visible, read from it rather than from positions on the grid. On a grid, give one entry per block (per column it sits in), with the block's whole rectangle in block, and list every hour label down the time axis in time_axis; when a block doesn't show its times, leave start_text and end_text null (code works them out from where the block sits). On a grid, a block's quote is the block's own text only, and days_text is the header of the column it sits in, which isn't part of the quote. Ignore names, IDs, and anything that isn't a class meeting. If it shows the last day of classes, fill term_end with those words and their quote. If it lists breaks or days with no classes, add each to breaks.
${RULES}`,
  schema: ScheduleExtraction,
  maxOutputTokens: 12_000,
  check: (o) =>
    fieldsInQuotes([
      ...o.classes.map((c, i) => ({
        label: `classes[${i}]`,
        quote: c.evidence.quote,
        // A grid block's day is its column's header, not in the block: code asks the person to confirm it.
        fields: [o.view === "grid" ? null : c.days_text, c.start_text, c.end_text],
      })),
      ...o.time_axis.map((t, i) => ({ label: `time_axis[${i}]`, quote: t.evidence.quote, fields: [t.label_text] })),
      ...termRows(o),
    ]),
};

export const syllabusPageTask: Task<SyllabusPageExtraction> = {
  name: "extract_syllabus_page",
  version: 6,
  // Minimal reasoning: half the thinking tokens, the same accuracy on the evals; a failed check retries at low.
  effort: "minimal",
  instructions: `You read one page of a course syllabus. Extract every dated or due item on this page: exams, quizzes, assignments, projects, readings. An exam whose date is "TBA" or "TBD" is still an item: date_text is those words as written. If the page says when classes begin, fill term_start with those words and their quote; if it says the last day of classes, fill term_end the same way. Add each break or day with no classes it lists (Thanksgiving break, spring break, "no class") to breaks, with its dates as written; these are not items.
Also read, only where this page says them: the lecture times (lectures); the words saying exams are held in class (exams_in_class, e.g. "in-class"); the words saying dates may change (dates_tentative, e.g. "TENTATIVE"); how far ahead an exam conflict must be reported (conflict_notice, e.g. "at least one week (7 days) in advance"); what it says about quizzes and where they're given (quizzes); office hours; the grade breakdown (grade_weights); and the list of topics or textbook sections (topics). These are not items. Never copy a person's name or email into any field.
${RULES}`,
  schema: SyllabusPageExtraction,
  maxOutputTokens: 14_000,
  check: (o) =>
    fieldsInQuotes([
      ...o.items.map((it, i) => ({
        label: `items[${i}]`,
        quote: it.evidence.quote,
        fields: [it.title, it.date_text, it.time_text],
      })),
      ...termRows(o),
      ...[...(o.lectures ?? []).map((m, i) => [`lectures[${i}]`, m] as const), ...(o.office_hours ?? []).map((m, i) => [`office_hours[${i}]`, m] as const)].map(([label, m]) => ({ label, quote: m.evidence.quote, fields: [m.days_text, m.time_text, m.location] })), // prettier-ignore
      ...(["exams_in_class", "dates_tentative", "conflict_notice"] as const).flatMap((k) => (o[k] ? [{ label: k, quote: o[k].evidence.quote, fields: [o[k].text] }] : [])), // prettier-ignore
      ...(o.quizzes ? [{ label: "quizzes", quote: o.quizzes.evidence.quote, fields: [o.quizzes.text, o.quizzes.where_text] }] : []), // prettier-ignore
      ...(o.grade_weights ?? []).map((g, i) => ({ label: `grade_weights[${i}]`, quote: g.evidence.quote, fields: [g.component, g.weight_text] })), // prettier-ignore
    ]),
};

const FREEFORM = `${RULES}
- course_hint is a course named or abbreviated next to the item, or in a heading above it ("MATH141", "calc", "131"). It doesn't have to be in the quote.
- change_text is the words saying the item changed ("moved to", "postponed", "extended", "now due"), copied from the quote, or null.
- A date written as the heading of the whole board or page isn't an item; skip it.
- Printed exercises, questions, or problems (on a worksheet, handout, quiz, or exam paper) are the page's content, not something to do; skip them. A quiz or exam paper that has already been taken (answers or a score written on it) isn't an upcoming item; skip its title too.
- legible is "unsure" if any word or number in the quote is hard to make out.
- Work that's already graded or handed back ("PS5 graded - pick up in discussion") is a task (an errand), not the assignment.`;

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
  version: 7,
  // Low, not minimal: at minimal a messy board sometimes loses a line ("PS5 graded, pick up"). Accuracy first.
  effort: "low",
  instructions: `You read a photo of a classroom whiteboard or a board of notes. Extract every item a student would need to act on or remember: exams, quizzes, assignments, tasks, reminders.
${FREEFORM}`,
  schema: WhiteboardExtraction,
  maxOutputTokens: 8_000,
  check: freeformCheck,
};

export const notesTask: Task<NotesExtraction> = {
  name: "extract_notes",
  version: 7,
  // Low, not minimal: at minimal a messy board sometimes loses a line ("PS5 graded, pick up"). Accuracy first.
  effort: "low",
  instructions: `You read a photo of a student's handwritten notes or to-do list. Extract every item on it: exams, quizzes, assignments, tasks, reminders.
${FREEFORM}
- crossed_out is true if the line is struck through or checked off. Still extract it.`,
  schema: NotesExtraction,
  maxOutputTokens: 8_000,
  check: freeformCheck,
};

export const lmsTask: Task<WhiteboardExtraction> = {
  name: "extract_lms",
  version: 4,
  // Minimal reasoning: half the thinking tokens, the same accuracy on the evals; a failed check retries at low.
  effort: "minimal",
  instructions: `You read a screenshot of a course website's to-do list, assignments page, or calendar (Canvas, ELMS, or similar). Extract every assignment, quiz, exam, or task listed with what it's for.
${FREEFORM}
- The quote is the item's whole row or card as shown, including its due line ("Problem Set 6 MATH141 Due Nov 5 at 11:59pm 10 pts").
- date_text and time_text are the due date and time as shown ("Nov 5", "11:59pm"), never the points or the date it was posted.`,
  schema: WhiteboardExtraction,
  maxOutputTokens: 8_000,
  check: freeformCheck,
};

/** What a texted photo is, before it's read: picks the reading task, and skips reading a photo that can't be read. */
export const PhotoClass = z.object({
  kind: z.enum(["whiteboard_photo", "notes_photo", "syllabus_page", "testudo_screenshot", "lms_screenshot", "other"]),
  readable: z.enum(["clear", "partly", "no"]),
});
export type PhotoClass = z.infer<typeof PhotoClass>;

export const classifyTask: Task<PhotoClass> = {
  name: "classify_photo",
  version: 1,
  instructions: `Say what this image is, for a student planner that reads schedules and deadlines:
- whiteboard_photo: a photo of a classroom whiteboard or chalkboard.
- notes_photo: handwritten notes, a paper planner, sticky notes, or a handwritten to-do list.
- syllabus_page: a printed or on-screen page of a course syllabus or course schedule table.
- testudo_screenshot: a university class schedule (a weekly grid or list of class meetings with days and times).
- lms_screenshot: a course website's to-do list, assignments page, or calendar (Canvas, ELMS, Blackboard, Moodle).
- other: anything else.
readable: "clear" if the writing can be read; "partly" if some of it is blurry, cut off, or too small; "no" if almost none of it can be read.`,
  schema: PhotoClass,
  effort: "minimal",
  maxOutputTokens: 300,
};

const TASKS: Record<SourceKind, Task<unknown>> = {
  testudo_screenshot: scheduleTask as Task<unknown>,
  testudo_text: scheduleTask as Task<unknown>,
  syllabus_pdf: syllabusPageTask as Task<unknown>,
  whiteboard_photo: whiteboardTask as Task<unknown>,
  notes_photo: notesTask as Task<unknown>,
  lms_screenshot: lmsTask as Task<unknown>,
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
