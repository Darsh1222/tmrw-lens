import { describe, expect, it } from "vitest";
import { auditPlan } from "@/lib/plan/audit";
import { buildPlan } from "@/lib/plan/build";
import { matchCourse, familyOf } from "@/lib/plan/courses";
import { verifyReading } from "@/lib/plan/verify";
import type { PageReading, SourceMeta, SourceReading } from "@/lib/plan/types";
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
        course_code: "CMSC131", course_title: "Object-Oriented Programming I", term_start: null,
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
        course_code: "CMSC131", course_title: null, term_start: null,
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
