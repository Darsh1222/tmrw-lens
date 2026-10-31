import { describe, expect, it } from "vitest";
import { answerQuestion } from "@/lib/plan/answer";
import { auditPlan } from "@/lib/plan/audit";
import { buildPlan } from "@/lib/plan/build";
import { matchCourse, familyOf } from "@/lib/plan/courses";
import { dedupeObjects, objectFor } from "@/lib/plan/objects";
import { verifyReading } from "@/lib/plan/verify";
import type { PageReading, SceneObject, SourceMeta, SourceReading } from "@/lib/plan/types";
import type { ModelBox } from "@/lib/schemas/evidence";

const ZONE = "America/New_York";
const box: ModelBox = { x_min: 100, y_min: 100, x_max: 900, y_max: 150 };
const ev = (quote: string) => ({ quote, box });

const source = (
  id: string,
  kind: SourceMeta["kind"],
  label: string,
  captured_at: string | null = null,
): SourceMeta => ({
  id,
  kind,
  label,
  captured_at,
  added_at: "2026-10-28T12:00:00-04:00",
});

const syllabusText = [
  "Classes begin Monday, August 31, 2026.",
  "7 Oct 12 - Oct 16 Trig substitution Problem Set 5 due Week 7 Thu",
  "9 Oct 26 - Oct 30 Improper integrals Quiz 3, Fri Oct 30",
  "12 Nov 16 - Nov 20 Power series Quiz 4, Fri Nov 20",
  "8 Oct 19 - Oct 23 Partial fractions Midterm 1, Wed Oct 21, in class",
].join("\n");

const syllabusItem = (
  title: string,
  kind: string,
  date_text: string | null,
  time_text: string | null,
  quote: string,
) => ({
  kind: kind as "quiz",
  title,
  date_text,
  time_text,
  weight_text: null,
  evidence: ev(quote),
});

function mathSyllabus(): SourceReading {
  return {
    source: source("syllabus", "syllabus_pdf", "MATH141 syllabus"),
    pages: [
      {
        page: 1,
        text: syllabusText,
        rereads: {},
        extraction: {
          course_code: "MATH141",
          course_title: "Calculus II",
          term_start: { date_text: "August 31, 2026", evidence: ev("Classes begin Monday, August 31, 2026.") },
          term_end: null,
          items: [
            syllabusItem("Problem Set 5", "assignment", "Week 7 Thu", null, "Problem Set 5 due Week 7 Thu"),
            syllabusItem("Quiz 3", "quiz", "Fri Oct 30", null, "Quiz 3, Fri Oct 30"),
            syllabusItem("Quiz 4", "quiz", "Fri Nov 20", null, "Quiz 4, Fri Nov 20"),
            syllabusItem("Midterm 1", "exam", "Wed Oct 21", "in class", "Midterm 1, Wed Oct 21, in class"),
          ],
        },
      },
    ],
  };
}

type Free = {
  title: string;
  kind: string;
  course_hint: string | null;
  date_text: string | null;
  time_text: string | null;
  change_text: string | null;
  quote: string;
};
function photo(
  id: string,
  kind: "whiteboard_photo" | "notes_photo",
  label: string,
  taken: string,
  items: Free[],
): SourceReading {
  const page: PageReading = {
    page: null,
    text: null,
    rereads: Object.fromEntries(items.map((it, i) => [`items.${i}`, { text: it.quote, legible: "clear" as const }])),
    extraction: {
      items: items.map((it) => ({
        kind: it.kind as "quiz",
        title: it.title,
        course_hint: it.course_hint,
        date_text: it.date_text,
        time_text: it.time_text,
        change_text: it.change_text,
        legible: "clear" as const,
        crossed_out: false,
        evidence: ev(it.quote),
      })),
    },
  };
  return { source: source(id, kind, label, taken), pages: [page] };
}

const schedule: SourceReading = {
  source: source("testudo", "testudo_text", "Testudo schedule"),
  pages: [
    {
      page: null,
      text: "MATH141 (0121) Calculus II\n  Lec  MWF  10:00am - 10:50am  ESJ 0224\nPHYS161 (0101) General Physics: Mechanics\n  Lec  MWF  1:00pm - 1:50pm  PHY 1412",
      rereads: {},
      extraction: {
        term_text: "Fall 2026",
        term_end: null,
        view: "text",
        classes: [
          { course_code: "MATH141", section: "0121", title: "Calculus II", meeting_type: "lecture", days_text: "MWF", start_text: "10:00am", end_text: "10:50am", location: "ESJ 0224", evidence: ev("Lec  MWF  10:00am - 10:50am  ESJ 0224") },
          { course_code: "PHYS161", section: "0101", title: "General Physics: Mechanics", meeting_type: "lecture", days_text: "MWF", start_text: "1:00pm", end_text: "1:50pm", location: "PHY 1412", evidence: ev("Lec  MWF  1:00pm - 1:50pm  PHY 1412") },
        ],
      },
    },
  ],
}; // prettier-ignore

const sources = (rs: SourceReading[]) => rs.map((r) => r.source);
const find = (plan: ReturnType<typeof buildPlan>, title: string) => plan.items.find((i) => i.title === title)!;

describe("matching", () => {
  it("reads course nicknames and item numbers", () => {
    const known = [
      { code: "MATH141", title: "Calculus II" },
      { code: "CMSC131", title: "Object-Oriented Programming I" },
    ];
    expect(matchCourse("calc", known).code).toBe("MATH141");
    expect(matchCourse("CMSC 131", known).code).toBe("CMSC131");
    expect(matchCourse("131", known).code).toBe("CMSC131");
    expect(matchCourse("bio", known)).toEqual({ code: null, ambiguous: [] });
    expect(familyOf("PS6")).toEqual({ family: "pset", number: 6 });
    expect(familyOf("Problem Set 5")).toEqual({ family: "pset", number: 5 });
    expect(familyOf("Proj 4")).toEqual({ family: "project", number: 4 });
    expect(familyOf("quiz moved to Mon")).toEqual({ family: "quiz", number: null });
    // Something about Quiz 3 isn't Quiz 3.
    expect(familyOf("Quiz 3 corrections")).toEqual({ family: null, number: null });
    expect(familyOf("Midterm 1 review session")).toEqual({ family: null, number: null });
  });
});

describe("buildPlan", () => {
  it("resolves dates in code from the term start, with traces", () => {
    const plan = buildPlan([mathSyllabus()], { zone: ZONE });
    expect(plan.term_start.date?.value).toBe("2026-08-31");
    expect(find(plan, "Problem Set 5").date).toMatchObject({ value: "2026-10-15", trace: { rule: "week_of_term" } });
    expect(find(plan, "Quiz 3").status).toBe("verified");
    // "in class" with no schedule is the only open question.
    expect(plan.questions.map((q) => [q.about, q.type])).toEqual([[find(plan, "Midterm 1").id, "missing_fact"]]);
  });

  it("merges a duplicate that agrees, keeping both pieces of evidence", () => {
    const board = photo("board", "whiteboard_photo", "whiteboard photo", "2026-10-26T10:05:00-04:00", [
      { title: "Quiz", kind: "quiz", course_hint: "MATH141", date_text: "Fri", time_text: null, change_text: null, quote: "Quiz Fri: improper integrals" },
    ]); // prettier-ignore
    const plan = buildPlan([mathSyllabus(), board], { zone: ZONE });
    const quiz = find(plan, "Quiz 3");
    expect(quiz.evidence).toHaveLength(2);
    expect(quiz.conflict).toBeNull();
    expect(quiz.status).toBe("verified");
    expect(plan.items.filter((i) => i.family === "quiz")).toHaveLength(2); // Quiz 3 and Quiz 4
  });

  it("uses the quote to tell what an item is when the title doesn't say", () => {
    const board = photo("board", "whiteboard_photo", "whiteboard photo", "2026-10-26T10:05:00-04:00", [
      { title: "improper integrals", kind: "quiz", course_hint: "MATH141", date_text: "Fri", time_text: null, change_text: null, quote: "Quiz Fri: improper integrals" },
    ]); // prettier-ignore
    const plan = buildPlan([mathSyllabus(), board], { zone: ZONE });
    expect(find(plan, "Quiz 3").evidence).toHaveLength(2);
  });

  it("asks once about class days read off a grid", () => {
    const grid = structuredClone(schedule);
    grid.source = source("grid", "testudo_screenshot", "Testudo screenshot");
    const page = grid.pages[0];
    page.text = null;
    const ex = page.extraction as { view: string; classes: { days_text: string; evidence: { quote: string } }[] };
    ex.view = "grid";
    ex.classes.forEach((c, i) => {
      c.days_text = "Monday Wednesday Friday";
      c.evidence.quote = `Monday Wednesday Friday\n${["MATH141 Lec\n10:00am-10:50am", "PHYS161 Lec\n1:00pm-1:50pm"][i]}`;
      page.rereads[`classes.${i}`] = {
        text: `Monday Tuesday Wednesday ${c.evidence.quote.split("\n").slice(1).join(" ")}`,
        legible: "clear",
      };
    });
    const plan = buildPlan([grid], { zone: ZONE });
    expect(plan.classes.map((c) => [c.status, c.days])).toEqual([
      ["needs_question", [1, 3, 5]],
      ["needs_question", [1, 3, 5]],
    ]);
    expect(plan.questions.filter((q) => q.about === "grid")).toHaveLength(1);
  });

  it("marks a moved date as a conflict, asks once, and pre-selects the newer whiteboard", () => {
    const board = photo("board", "whiteboard_photo", "whiteboard photo", "2026-10-28T09:12:00-04:00", [
      { title: "Quiz", kind: "quiz", course_hint: "MATH141", date_text: "Mon", time_text: null, change_text: "moved to", quote: "Quiz moved to Mon!" },
    ]); // prettier-ignore
    const plan = buildPlan([mathSyllabus(), board], { zone: ZONE });
    const quiz = find(plan, "Quiz 3");
    expect(quiz.status).toBe("conflict");
    expect(quiz.date).toBeNull(); // nothing is picked until the person answers
    expect(quiz.conflict?.versions.map((v) => v.date?.value)).toEqual(["2026-10-30", "2026-11-02"]);
    expect(quiz.conflict?.versions.map((v) => v.evidence.source_id)).toEqual(["syllabus", "board"]);
    expect(find(plan, "Quiz 4").conflict).toBeNull(); // the later quiz isn't touched

    const qs = plan.questions.filter((q) => q.about === quiz.id);
    expect(qs).toHaveLength(1);
    const [q] = qs;
    expect(q.type).toBe("conflict");
    expect(q.prompt).toBe(
      "Quiz 3: the MATH141 syllabus says Fri Oct 30, but the whiteboard photo says Mon Nov 2. Which is right?",
    );
    expect(q.options.map((o) => o.value)).toEqual(["2026-10-30", "2026-11-02", "different"]);
    expect(q.suggested).toBe("v1");
    expect(q.why_suggested).toBe('The whiteboard photo was taken Wed Oct 28 and says "moved to".');
  });

  it("marks a time disagreement as a conflict and pre-selects the newer notes", () => {
    const cmsc: SourceReading = {
      source: source("cmsc", "syllabus_pdf", "CMSC131 syllabus"),
      pages: [{ page: 1, text: "Project 4 due Fri Nov 13, 11:59pm", rereads: {}, extraction: {
        course_code: "CMSC131", course_title: "Object-Oriented Programming I", term_start: null, term_end: null,
        items: [syllabusItem("Project 4", "project", "Fri Nov 13", "11:59pm", "Project 4 due Fri Nov 13, 11:59pm")],
      } }],
    }; // prettier-ignore
    const notes = photo("notes", "notes_photo", "notes photo", "2026-10-28T20:40:00-04:00", [
      { title: "Proj 4", kind: "assignment", course_hint: "CMSC131", date_text: "Fri 11/13", time_text: "5pm", change_text: null, quote: "Proj 4 due Fri 11/13 @ 5pm" },
    ]); // prettier-ignore
    const plan = buildPlan([cmsc, notes], { zone: ZONE });
    const p4 = find(plan, "Project 4");
    expect(p4.status).toBe("conflict");
    expect(p4.conflict?.fields).toEqual(["time"]);
    expect(p4.date?.value).toBe("2026-11-13"); // the date agrees, so it stays
    expect(p4.time).toBeNull();
    const q = plan.questions.find((x) => x.about === p4.id)!;
    expect(q.options.map((o) => o.value)).toEqual(["2026-11-13T23:59", "2026-11-13T17:00"]);
    expect(q.suggested).toBe("v1");
    expect(q.why_suggested).toContain("notes photo was taken Wed Oct 28");
  });

  it("fills in class times and flags overlaps with another course", () => {
    const exam: SourceReading = {
      source: source("cmsc", "syllabus_pdf", "CMSC131 syllabus"),
      pages: [{ page: 1, text: "Exam 2 Wed Nov 11, 1:00pm - 2:15pm", rereads: {}, extraction: {
        course_code: "CMSC131", course_title: null, term_start: null, term_end: null,
        items: [syllabusItem("Exam 2", "exam", "Wed Nov 11", "1:00pm - 2:15pm", "Exam 2 Wed Nov 11, 1:00pm - 2:15pm")],
      } }],
    }; // prettier-ignore
    const plan = buildPlan([mathSyllabus(), schedule, exam], { zone: ZONE });
    const m1 = find(plan, "Midterm 1");
    expect(m1.time).toMatchObject({ start: "10:00", end: "10:50", trace: { rule: "in_class" } });
    expect(m1.status).toBe("verified");
    const e2 = find(plan, "Exam 2");
    expect(e2.status).toBe("needs_question");
    expect(plan.questions.find((q) => q.about === e2.id)?.prompt).toBe(
      "Exam 2 (Wed Nov 11, 1pm-2:15pm) overlaps your PHYS161 lecture (1pm-1:50pm). Keep both?",
    );
    expect(plan.classes.find((c) => c.course === "MATH141")?.first_date?.value).toBe("2026-08-31");
  });

  it("marks a reading the second read disagrees with as unverified", () => {
    const board = photo("board", "whiteboard_photo", "whiteboard photo", "2026-10-28T09:12:00-04:00", [
      { title: "PS6", kind: "assignment", course_hint: "calc", date_text: "11/5", time_text: null, change_text: null, quote: "PS6 due Thu 11/5" },
    ]); // prettier-ignore
    board.pages[0].rereads["items.0"] = { text: "PS6 due Thu 11/8", legible: "clear" };
    const plan = buildPlan([mathSyllabus(), board], { zone: ZONE });
    const ps6 = plan.items.find((i) => i.number === 6)!;
    expect(ps6.status).toBe("unverified");
    expect(ps6.date).toBeNull();
    expect(plan.questions.find((q) => q.about === ps6.id)?.type).toBe("check");
  });

  it("asks for the term start once when nothing says it", () => {
    const s = mathSyllabus();
    (s.pages[0].extraction as { term_start: unknown }).term_start = null;
    const plan = buildPlan([s], { zone: ZONE });
    expect(find(plan, "Problem Set 5").date).toBeNull();
    expect(find(plan, "Quiz 3").date?.value).toBe("2026-10-30"); // still has a year from when it was added
    expect(plan.questions.filter((q) => q.about === "term" || q.about === find(plan, "Problem Set 5").id)).toEqual([
      expect.objectContaining({ id: "q_term_start" }),
    ]);
  });
});

describe("verifyReading", () => {
  const page = (text: string | null, reread?: string): PageReading => ({
    page: null,
    text,
    extraction: { items: [] },
    rereads: reread ? { "items.0": { text: reread, legible: "clear" } } : {},
  });
  it("accepts a quote made of lines that aren't next to each other, if each is in the source", () => {
    const text = "MATH141 (0121) Calculus II\n  Lec  MWF  10:00am\n  Dis  TuTh  9:00am";
    expect(verifyReading(page(text), "items.0", "MATH141 (0121) Calculus II\nDis  TuTh  9:00am", []).quote.status).toBe(
      "verified",
    );
    expect(verifyReading(page(text), "items.0", "MATH141 Calculus II\nDis TuTh 9:00am", []).quote.status).toBe(
      "unverified",
    );
  });
  it("fails a field the second read doesn't see, even when the line is close", () => {
    const r = verifyReading(page(null, "PS6 due Thu 11/"), "items.0", "PS6 due Thu 11/5", ["Thu 11/5"]);
    expect(r.quote.status).toBe("verified");
    expect(r.fields[0]).toEqual({ status: "unverified", reason: 'A second read saw "PS6 due Thu 11/".' });
  });
});

describe("auditPlan", () => {
  it("finds no invented dates in a built plan", () => {
    const board = photo("board", "whiteboard_photo", "whiteboard photo", "2026-10-28T09:12:00-04:00", [
      { title: "Quiz", kind: "quiz", course_hint: "MATH141", date_text: "Mon", time_text: null, change_text: "moved to", quote: "Quiz moved to Mon!" },
    ]); // prettier-ignore
    const readings = [mathSyllabus(), schedule, board];
    const plan = buildPlan(readings, { zone: ZONE });
    const audit = auditPlan(plan, sources(readings));
    expect(audit.invented).toEqual([]);
    expect(audit.dates).toBeGreaterThan(6);
  });

  it("catches a date that doesn't come from its words", () => {
    const readings = [mathSyllabus()];
    const plan = buildPlan(readings, { zone: ZONE });
    find(plan, "Quiz 3").date!.value = "2026-10-31";
    find(plan, "Quiz 4").date!.trace.text = "Fri Nov 27";
    const why = auditPlan(plan, sources(readings)).invented.map((f) => f.why);
    expect(why).toEqual(['"Fri Oct 30" recomputes to 2026-10-30, not 2026-10-31', '"Fri Nov 27" isn\'t in its quote']);
  });
});

/** The MATH141 syllabus plus extra lines, each "title|kind|date_text|time_text|quote". */
function withLines(lines: string[], termEnd = false): SourceReading {
  const s = mathSyllabus();
  const page = s.pages[0];
  const ex = page.extraction as { items: unknown[]; term_end: unknown };
  for (const l of lines) {
    const [title, kind, dateText, timeText, quote] = l.split("|");
    ex.items.push(syllabusItem(title, kind, dateText || null, timeText || null, quote));
    page.text += `\n${quote}`;
  }
  if (termEnd) {
    ex.term_end = { date_text: "December 8, 2026", evidence: ev("Last day of classes: Tuesday, December 8, 2026.") };
    page.text += "\nLast day of classes: Tuesday, December 8, 2026.";
  }
  return s;
}

describe("dates relative to another item", () => {
  const movedBoard = () =>
    photo("board", "whiteboard_photo", "whiteboard photo", "2026-10-28T09:12:00-04:00", [
      { title: "Quiz", kind: "quiz", course_hint: "MATH141", date_text: "Mon", time_text: null, change_text: "moved to", quote: "Quiz moved to Mon!" },
    ]); // prettier-ignore

  it("resolves 'before Midterm 1' from Midterm 1, and takes its start time when the schedule gives one", () => {
    const readings = [
      withLines(["Reading|reading|before Midterm 1||Reading: Stewart 7.1-7.5 before Midterm 1."]),
      schedule,
    ];
    const plan = buildPlan(readings, { zone: ZONE });
    const reading = find(plan, "Reading");
    expect(reading.depends_on).toEqual({
      item_id: find(plan, "Midterm 1").id,
      text: "before Midterm 1",
      offset_days: 0,
    });
    expect(reading.date).toMatchObject({ value: "2026-10-21", trace: { rule: "offset" } });
    expect(reading.time).toMatchObject({ start: "10:00", end: null, trace: { rule: "before_item" } });
    expect(reading.status).toBe("verified");
    expect(plan.questions.filter((q) => q.about === reading.id)).toEqual([]);
    expect(auditPlan(plan, sources(readings)).invented).toEqual([]);
  });

  it("waits on a conflict without a question of its own, then moves when it's answered", () => {
    const readings = [
      withLines(["Quiz 3 corrections|assignment|the day after Quiz 3||Quiz 3 corrections due the day after Quiz 3."]),
      movedBoard(),
    ];
    const plan = buildPlan(readings, { zone: ZONE });
    const fix = find(plan, "Quiz 3 corrections");
    expect(fix.date).toBeNull();
    expect(fix.checks.date.reason).toBe("Waits on the Quiz 3 question.");
    expect(plan.questions.filter((q) => q.about === fix.id)).toEqual([]);

    const q = plan.questions.find((x) => x.type === "conflict")!;
    const moved = answerQuestion(plan, q.id, "v1"); // the whiteboard: Mon Nov 2
    expect(find(moved, "Quiz 3").date?.value).toBe("2026-11-02");
    expect(find(moved, "Quiz 3").status).toBe("verified");
    expect(find(moved, "Quiz 3 corrections").date?.value).toBe("2026-11-03");
    expect(find(moved, "Quiz 3 corrections").status).toBe("verified");
    expect(moved.questions.find((x) => x.id === q.id)).toBeUndefined();
    expect(auditPlan(moved, sources(readings)).invented).toEqual([]);

    const kept = answerQuestion(plan, q.id, "v0"); // the syllabus: Fri Oct 30
    expect(find(kept, "Quiz 3 corrections").date?.value).toBe("2026-10-31");
    expect(plan.items.find((i) => i.id === fix.id)?.date).toBeNull(); // answering doesn't change the original plan
  });

  it("asks which item when it could be more than one, and links the answer", () => {
    const cmsc: SourceReading = {
      source: source("cmsc", "syllabus_pdf", "CMSC131 syllabus"),
      pages: [{ page: 1, text: "Project 3 due Sun Nov 1\nProject 4 due Fri Nov 13\nReflection due the week after the project", rereads: {}, extraction: {
        course_code: "CMSC131", course_title: null, term_start: null, term_end: null,
        items: [
          syllabusItem("Project 3", "project", "Sun Nov 1", null, "Project 3 due Sun Nov 1"),
          syllabusItem("Project 4", "project", "Fri Nov 13", null, "Project 4 due Fri Nov 13"),
          syllabusItem("Reflection", "assignment", "the week after the project", null, "Reflection due the week after the project"),
        ],
      } }],
    }; // prettier-ignore
    const plan = buildPlan([cmsc], { zone: ZONE });
    const r = find(plan, "Reflection");
    const qs = plan.questions.filter((q) => q.about === r.id);
    expect(qs.map((q) => q.type)).toEqual(["which_item"]);
    expect(qs[0].options.map((o) => o.label)).toEqual([
      "Project 3 (Sun Nov 1)",
      "Project 4 (Fri Nov 13)",
      "Pick the date",
    ]);
    const after = answerQuestion(plan, qs[0].id, find(plan, "Project 4").id);
    expect(find(after, "Reflection").date?.value).toBe("2026-11-20");
    expect(auditPlan(after, sources([cmsc])).invented).toEqual([]);
  });

  it("asks when the item it points at isn't there", () => {
    const plan = buildPlan(
      [withLines(["Lab writeup|assignment|before the lab practical||Lab writeup before the lab practical"])],
      {
        zone: ZONE,
      },
    );
    const q = plan.questions.find((x) => x.about === find(plan, "Lab writeup").id)!;
    expect(q.type).toBe("which_item");
    expect(q.prompt).toBe(
      'When is "Lab writeup"? It says before the lab practical, and I can\'t find the lab practical in what you added.',
    );
  });
});

describe("class recurrences", () => {
  it("end on the last day of classes when the syllabus gives it", () => {
    const readings = [withLines([], true), schedule];
    const plan = buildPlan(readings, { zone: ZONE });
    expect(plan.term_end.date?.value).toBe("2026-12-08");
    const math = plan.classes.find((c) => c.course === "MATH141")!;
    expect(math.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261209T045959Z");
    expect(math.last_date?.value).toBe("2026-12-07");
    expect(plan.questions.find((q) => q.id === "q_term_end")).toBeUndefined();
    expect(auditPlan(plan, sources(readings)).invented).toEqual([]);
  });
  it("ask once for the last day when nothing says it", () => {
    const plan = buildPlan([mathSyllabus(), schedule], { zone: ZONE });
    expect(plan.classes.every((c) => !c.rrule.includes("UNTIL") && c.last_date === null)).toBe(true);
    expect(plan.questions.filter((q) => q.id === "q_term_end")).toHaveLength(1);
  });
  it("catch an end date that isn't the term's", () => {
    const readings = [withLines([], true), schedule];
    const plan = buildPlan(readings, { zone: ZONE });
    plan.classes[0].rrule = plan.classes[0].rrule.replace("20261209", "20261215");
    expect(auditPlan(plan, sources(readings)).invented.map((f) => f.field)).toEqual(["rrule"]);
  });
});

describe("SAM objects", () => {
  const square = (id: string, label: SceneObject["label"], x0: number, y0: number, x1: number, y1: number, confidence = 0.9): SceneObject => ({
    id, label, confidence, bbox: { x0, y0, x1, y1 }, outline: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
  }); // prettier-ignore
  const board = square("whiteboard_0", "whiteboard", 0, 0, 1, 1);
  const note = square("sticky_note_0", "sticky_note", 0.1, 0.1, 0.4, 0.4);
  it("puts a quote in the smallest object around it", () => {
    expect(objectFor({ x0: 0.15, y0: 0.2, x1: 0.35, y1: 0.25 }, [board, note])?.id).toBe("sticky_note_0");
    expect(objectFor({ x0: 0.6, y0: 0.6, x1: 0.8, y1: 0.7 }, [board, note])?.id).toBe("whiteboard_0");
    expect(objectFor({ x0: 0.6, y0: 0.6, x1: 0.8, y1: 0.7 }, [note])).toBeNull();
  });
  it("keeps one object when 'paper' and 'sticky note' find the same note", () => {
    const paper = square("paper_0", "paper", 0.11, 0.1, 0.4, 0.41);
    expect(dedupeObjects([paper, note, board]).map((o) => o.id)).toEqual(["sticky_note_0", "whiteboard_0"]);
  });
  it("uses the object's outline as the highlight", () => {
    const notes = photo("notes", "notes_photo", "sticky notes photo", "2026-10-29T08:30:00-04:00", [
      { title: "PHYS HW 8", kind: "assignment", course_hint: "PHYS", date_text: "Fri 11/6", time_text: null, change_text: null, quote: "PHYS HW 8 due Fri 11/6" },
    ]); // prettier-ignore
    const page = notes.pages[0];
    const ex = page.extraction as { items: { evidence: { box: ModelBox } }[] };
    ex.items[0].evidence.box = { x_min: 150, y_min: 200, x_max: 350, y_max: 260 };
    page.objects = [board, note];
    const plan = buildPlan([notes], { zone: ZONE });
    expect(plan.items[0].evidence[0].region).toEqual({
      object_id: "sticky_note_0",
      label: "sticky_note",
      outline: note.outline,
    });
  });
});
