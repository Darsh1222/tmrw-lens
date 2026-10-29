import type { DateInputs, DateRule, Weekday } from "@/lib/resolve/dates";
import type { Evidence, SourceKind } from "@/lib/schemas/evidence";
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
};

export type SourceReading = { source: SourceMeta; pages: PageReading[] };

export type DateTrace = {
  /** The words as written, e.g. "Week 7 Thu". Always inside `evidence.quote`. */
  text: string;
  evidence: Evidence;
  rule: DateRule | "first_meeting";
  inputs: DateInputs;
};
export type TracedDate = { value: string; trace: DateTrace };

export type TimeTrace = {
  text: string;
  evidence: Evidence;
  rule: "clock" | "in_class";
  /** For "in class": the class block whose meeting time was used. */
  class_id: string | null;
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
  /** Unresolved time words, e.g. "in class" with no schedule, kept for the question. */
  time_text: string | null;
  evidence: Evidence;
  checks: { quote: Check; title: Check; course: Check; date: Check; time: Check };
  /** Why the date couldn't be resolved, and candidate dates when it's a choice. */
  date_needs: { needs: "term_start" | "photo_date" | "choice" | "rewrite"; options: string[] } | null;
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
  rrule: string;
  first_date: TracedDate | null;
  evidence: Evidence;
  checks: { quote: Check; days: Check; time: Check };
  status: Status;
};

export type QuestionOption = {
  id: string;
  label: string;
  /** A date, time, or "different"/"keep"; null means "let me type it". */
  value: string | null;
  evidence: Evidence | null;
};

export type Question = {
  id: string;
  /** The item (or "term") it's about. */
  about: string;
  type: "conflict" | "choose_date" | "missing_fact" | "unreadable" | "class_overlap" | "course" | "check";
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
  status: Status;
};

export type TermStart = { date: TracedDate | null; check: Check };

export type Plan = {
  zone: string;
  term_start: TermStart;
  classes: ClassBlock[];
  items: PlanItem[];
  questions: Question[];
  /** Crossed-out lines, kept so the card can say they were left out on purpose. */
  crossed_out: Candidate[];
};
