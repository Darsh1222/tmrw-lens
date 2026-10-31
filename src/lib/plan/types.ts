import type { DateInputs, DateRule, Weekday } from "@/lib/resolve/dates";
import type { Point } from "@/lib/images/geometry";
import type { BBox, Evidence, ObjectLabel, SourceKind } from "@/lib/schemas/evidence";
import type {
  NotesExtraction,
  ScheduleExtraction,
  SyllabusPageExtraction,
  WhiteboardExtraction,
} from "@/lib/schemas/extraction";

// What Lens builds from the readings of every source: class blocks, items, and
// the questions it still has. Every field carries its own status, and every date
// carries a trace back to the words it came from and the rule that computed it.

/**
 * - verified: read, re-read, and computed with nothing left to decide.
 * - needs_question: readable, but one question settles it.
 * - unverified: the reading didn't hold up (not in the quote, re-read differently).
 * - conflict: two sources disagree; the person picks.
 */
export type Status = "verified" | "needs_question" | "unverified" | "conflict";
export type Check = { status: Status; reason: string | null };
export const ok: Check = { status: "verified", reason: null };

export type SourceMeta = {
  id: string;
  kind: SourceKind;
  label: string;
  /** When a photo was taken, ISO with offset. null for documents (syllabus, Testudo), which aren't dated by capture. */
  captured_at: string | null;
  /** When it was added to Lens, ISO with offset. Only used for the year of a date written without one. */
  added_at: string;
};

export type Reread = { text: string; legible: "clear" | "unsure" };

/** One thing SAM found in a photo: a sticky note, a sheet of paper, or the whiteboard. */
export type SceneObject = {
  id: string;
  label: ObjectLabel;
  bbox: BBox;
  outline: Point[];
  confidence: number | null;
};

export type PageReading = {
  page: number | null;
  /** The page's own text when there is one (pasted text, a PDF's text layer); quotes are checked against it. */
  text: string | null;
  extraction: ScheduleExtraction | SyllabusPageExtraction | WhiteboardExtraction | NotesExtraction;
  /**
   * An independent re-read of each box, keyed by where the quote sits in the extraction ("items.3",
   * "classes.0", "term_start"). Missing where there was no box to crop, or the page has its own text.
   */
  rereads: Record<string, Reread>;
  /** What SAM found on the photo. Absent when SAM wasn't run (documents, or segmentation off). */
  objects?: SceneObject[];
};

export type SourceReading = { source: SourceMeta; pages: PageReading[] };

export type DateTrace = {
  /** The words as written, e.g. "Week 7 Thu". Always inside `evidence.quote`. */
  text: string;
  evidence: Evidence;
  rule: DateRule | "first_meeting" | "last_meeting";
  inputs: DateInputs;
};
export type TracedDate = { value: string; trace: DateTrace };

export type TimeTrace = {
  text: string;
  evidence: Evidence;
  rule: "clock" | "in_class" | "before_item";
  /** For "in class": the class block whose meeting time was used. */
  class_id: string | null;
  /** For "before Midterm 1": the item whose start time was used. */
  item_id?: string;
};
export type TracedTime = { start: string; end: string | null; trace: TimeTrace };

export type ItemKind = "deadline" | "exam" | "task";

/** One source's reading of one item, resolved and checked, before merging. */
export type Candidate = {
  id: string;
  source: SourceMeta;
  kind: ItemKind;
  /** quiz, midterm, pset, project...: what kind of thing, for matching across sources. */
  family: string | null;
  number: number | null;
  title: string;
  course: string | null;
  /** Words saying it changed ("moved to"), as written. */
  change_text: string | null;
  crossed_out: boolean;
  date: TracedDate | null;
  time: TracedTime | null;
  /** The date words as written, kept for dates that depend on another item ("before Midterm 1"). */
  date_text: string | null;
  /** Unresolved time words, e.g. "in class" with no schedule, kept for the question. */
  time_text: string | null;
  evidence: Evidence;
  checks: { quote: Check; title: Check; course: Check; date: Check; time: Check };
  /** Why the date couldn't be resolved, and candidate dates when it's a choice. */
  date_needs: { needs: "term_start" | "photo_date" | "choice" | "rewrite" | "reference"; options: string[] } | null;
  legibility: { reread: string | null; unsure: boolean };
};

export type ClassBlock = {
  id: string;
  source: SourceMeta;
  course: string;
  section: string | null;
  title: string | null;
  meeting_type: "lecture" | "discussion" | "lab" | "other";
  days: Weekday[];
  start: string;
  end: string;
  location: string | null;
  /** Weekly, with UNTIL at the end of the last day of classes when that's known. */
  rrule: string;
  first_date: TracedDate | null;
  /** The last meeting on or before the last day of classes. */
  last_date: TracedDate | null;
  evidence: Evidence;
  checks: { quote: Check; days: Check; time: Check };
  status: Status;
};

export type QuestionOption = {
  id: string;
  label: string;
  /** A date, time, "different"/"keep", or "item:<id>" for which item a relative date means; null means "let me type it". */
  value: string | null;
  evidence: Evidence | null;
};

export type Question = {
  id: string;
  /** The item (or "term") it's about. */
  about: string;
  type:
    "conflict" | "choose_date" | "missing_fact" | "unreadable" | "class_overlap" | "course" | "check" | "which_item";
  prompt: string;
  options: QuestionOption[];
  /** Pre-selected option id, never applied until the person answers. */
  suggested: string | null;
  why_suggested: string | null;
};

export type Conflict = {
  fields: ("date" | "time")[];
  /** One version per source that disagrees, with the candidate it came from. */
  versions: { candidate_id: string; date: TracedDate | null; time: TracedTime | null; evidence: Evidence }[];
  /** True when it's not certain the sources mean the same item (e.g. "quiz moved to Mon" vs "Quiz 3"). */
  maybe_different: boolean;
  /** The candidate whose version the person picked; null until they answer. */
  chosen: string | null;
};

export type PlanItem = {
  id: string;
  kind: ItemKind;
  title: string;
  course: string | null;
  family: string | null;
  number: number | null;
  date: TracedDate | null;
  time: TracedTime | null;
  evidence: Evidence[];
  candidates: string[];
  checks: Candidate["checks"];
  conflict: Conflict | null;
  /**
   * A date written relative to another item ("before Midterm 1", "the week after Project 4"). The date is recomputed
   * from that item's whenever it changes, so answering that item's question moves this one too. `item_id` is null
   * while it's unclear which item it means (its question asks).
   */
  depends_on: { item_id: string | null; text: string; offset_days: number } | null;
  status: Status;
};

/** The first or last day of classes. */
export type TermDate = { date: TracedDate | null; check: Check };

export type Plan = {
  zone: string;
  term_start: TermDate;
  term_end: TermDate;
  classes: ClassBlock[];
  items: PlanItem[];
  questions: Question[];
  /** Crossed-out lines, kept so the card can say they were left out on purpose. */
  crossed_out: Candidate[];
};
