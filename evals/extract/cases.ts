import type { Answer } from "@/lib/plan/answer";
import type { ExistingItem, ExtractRequest } from "@/lib/tomorrow/extract";

// Text-a-photo cases, over synthetic fixtures. `auto_apply` is the gold list:
// exactly the items that should be created without asking, with their dates
// and times (null time: date-only must stay date-only). `optional` items may be
// auto-applied if their date is right, but aren't required. `answers` are
// replayed after the first response, as the person's texts would be.

export type Expected = { title: string; date: string; time: string | null };

export type ExtractCase = {
  name: string;
  about: string;
  images: string[];
  now: string;
  existing: ExistingItem[];
  term: ExtractRequest["term"];
  answers: Answer[];
  expect: {
    auto_apply: Expected[];
    optional?: Expected[];
    changes?: { existing_id: string; to: string; kind: "moved" | "contradiction" }[];
    duplicates?: string[];
    min_questions?: number;
  };
};

const TERM = { start: "2026-08-31", end: "2026-12-08" };
const syllabus = (
  id: string,
  title: string,
  course: string,
  date: string,
  kind: ExistingItem["kind"],
  time: string | null = null,
): ExistingItem =>
  // prettier-ignore
  ({ id, title, kind, course, date, time, source: `${course} syllabus` });

export const EXTRACT_CASES: ExtractCase[] = [
  {
    name: "whiteboard-moves-quiz",
    about: "A whiteboard photo says the quiz moved; Tomorrow has Quiz 3 on Fri Oct 30 from the syllabus.",
    images: ["whiteboard-quiz-moved.jpg"],
    now: "2026-10-28T11:05:00-04:00",
    existing: [
      syllabus("t_quiz3", "Quiz 3", "MATH141", "2026-10-30", "exam"),
      syllabus("t_ps6", "Problem Set 6", "MATH141", "2026-11-05", "deadline"),
      syllabus("t_essay2", "Essay 2", "ENGL101", "2026-11-06", "deadline", "23:59"),
    ],
    term: TERM,
    // The photo has no capture time (texted photos often don't): they confirm it was today.
    answers: [{ question_id: "q_photo_date_photo1", option_id: "today" }],
    expect: {
      auto_apply: [],
      optional: [{ title: "Office hours", date: "2026-10-28", time: "14:00" }],
      changes: [{ existing_id: "t_quiz3", to: "2026-11-02", kind: "moved" }],
      duplicates: ["t_ps6"],
    },
  },
  {
    name: "canvas-todo",
    about: "A course site's to-do list: five deadlines across four courses, one with no time.",
    images: ["canvas-todo.png"],
    now: "2026-11-01T18:00:00-05:00",
    existing: [],
    term: TERM,
    answers: [],
    expect: {
      auto_apply: [
        { title: "Problem Set 6", date: "2026-11-05", time: "23:59" },
        { title: "Essay 2 draft", date: "2026-11-06", time: "23:59" },
        { title: "Project 4", date: "2026-11-09", time: "23:00" },
        { title: "Reading response 7", date: "2026-11-10", time: null },
        { title: "Quiz 4", date: "2026-11-12", time: "10:00" },
      ],
    },
  },
  {
    name: "canvas-vs-existing",
    about: "The same list, when Tomorrow already has Problem Set 6, and Quiz 4 on a different day.",
    images: ["canvas-todo.png"],
    now: "2026-11-01T18:00:00-05:00",
    existing: [
      syllabus("t_ps6", "Problem Set 6", "MATH141", "2026-11-05", "deadline"),
      syllabus("t_quiz4", "Quiz 4", "MATH141", "2026-11-13", "exam"),
    ],
    term: TERM,
    answers: [],
    expect: {
      auto_apply: [
        { title: "Essay 2 draft", date: "2026-11-06", time: "23:59" },
        { title: "Project 4", date: "2026-11-09", time: "23:00" },
        { title: "Reading response 7", date: "2026-11-10", time: null },
      ],
      changes: [{ existing_id: "t_quiz4", to: "2026-11-12", kind: "contradiction" }],
      duplicates: ["t_ps6"],
    },
  },
  {
    name: "blurry",
    about: "A whiteboard photo too blurry to read: questions, not guesses.",
    images: ["whiteboard-blurry.jpg"],
    now: "2026-10-30T11:00:00-04:00",
    existing: [syllabus("t_quiz4", "Quiz 4", "MATH141", "2026-11-12", "exam")],
    term: TERM,
    answers: [],
    expect: { auto_apply: [], min_questions: 1 },
  },
];
