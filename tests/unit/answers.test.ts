import { describe, expect, it } from "vitest";
import { auditPlan } from "@/lib/plan/audit";
import { buildPlan } from "@/lib/plan/build";
import { planFrom } from "@/lib/plan/session";
import type { SourceMeta, SourceReading } from "@/lib/plan/types";
import { parseDateRange } from "@/lib/resolve/dates";
import type { ModelBox } from "@/lib/schemas/evidence";

const ZONE = "America/New_York";
const box: ModelBox = { x_min: 100, y_min: 100, x_max: 900, y_max: 150 };
const ev = (quote: string) => ({ quote, box });
const src = (id: string, kind: SourceMeta["kind"], label: string, captured_at: string | null = null): SourceMeta => ({
  id,
  kind,
  label,
  captured_at,
  added_at: "2026-10-28T12:00:00-04:00",
});

const lines = {
  start: "Classes begin Monday, August 31, 2026.",
  end: "Last day of classes: Tuesday, December 8, 2026.",
  thanks: "Thanksgiving break: no classes Nov 25-29",
  pset: "Problem Set 5 due Week 7 Thu",
  quiz: "Quiz 3, Fri Oct 30",
};

function syllabus({ term = true, breaks = true } = {}): SourceReading {
  const text = [term && lines.start, lines.end, breaks && lines.thanks, lines.pset, lines.quiz].filter(Boolean).join("\n"); // prettier-ignore
  return {
    source: src("syl", "syllabus_pdf", "MATH141 syllabus"),
    pages: [
      {
        page: 1,
        text,
        rereads: {},
        extraction: {
          course_code: "MATH141",
          course_title: "Calculus II",
          term_start: term ? { date_text: "August 31, 2026", evidence: ev(lines.start) } : null,
          term_end: { date_text: "December 8, 2026", evidence: ev(lines.end) },
          breaks: breaks ? [{ name: "Thanksgiving break", dates_text: "Nov 25-29", evidence: ev(lines.thanks) }] : [],
          items: [
            { kind: "assignment", title: "Problem Set 5", date_text: "Week 7 Thu", time_text: null, weight_text: null, evidence: ev(lines.pset) }, // prettier-ignore
            { kind: "quiz", title: "Quiz 3", date_text: "Fri Oct 30", time_text: null, weight_text: null, evidence: ev(lines.quiz) }, // prettier-ignore
          ],
        },
      },
    ],
  };
}

const classLine = "Lec  MWF  10:00am - 10:50am  ESJ 0224";
const schedule: SourceReading = {
  source: src("testudo", "testudo_text", "Testudo schedule"),
  pages: [
    {
      page: null,
      text: `MATH141 (0121) Calculus II\n  ${classLine}`,
      rereads: {},
      extraction: {
        term_text: "Fall 2026",
        term_end: null,
        breaks: [],
        view: "text",
        classes: [
          { course_code: "MATH141", section: "0121", title: "Calculus II", meeting_type: "lecture", days_text: "MWF", start_text: "10:00am", end_text: "10:50am", location: "ESJ 0224", evidence: ev(classLine) }, // prettier-ignore
        ],
      },
    },
  ],
};

function board(
  lineText: string,
  item: { title: string; date_text: string; change_text: string | null },
): SourceReading {
  return {
    source: src("board", "whiteboard_photo", "whiteboard photo", "2026-10-28T10:51:00-04:00"),
    pages: [
      {
        page: null,
        text: null,
        rereads: { "items.0": { text: lineText, legible: "clear" } },
        extraction: {
          items: [
            {
              kind: "quiz",
              course_hint: "MATH141",
              time_text: null,
              legible: "clear",
              evidence: ev(lineText),
              ...item,
            },
          ],
        },
      },
    ],
  };
}

const clean = (rs: SourceReading[], answers: Parameters<typeof planFrom>[1]["answers"] = []) => {
  const s = planFrom(rs, { zone: ZONE, answers });
  expect(auditPlan(s.plan, s.sources).invented).toEqual([]);
  return s;
};

describe("date ranges", () => {
  const inputs = { term_start: "2026-08-31", photo_date: null, added_date: "2026-10-28" };
  it.each([
    ["Nov 25-29", "2026-11-25", "2026-11-29"],
    ["November 25 - November 29", "2026-11-25", "2026-11-29"],
    ["November 25 – 29, 2026", "2026-11-25", "2026-11-29"],
    ["11/25-11/29", "2026-11-25", "2026-11-29"],
    ["Wed Nov 25 through Sun Nov 29", "2026-11-25", "2026-11-29"],
    ["Wed Nov 11", "2026-11-11", "2026-11-11"],
  ])("%s", (text, start, end) => {
    expect(parseDateRange(text, inputs)).toMatchObject({ ok: true, start, end });
  });
  it("refuses what isn't a break", () => {
    expect(parseDateRange("Nov 29-25", inputs).ok).toBe(false);
    expect(parseDateRange("Sep 1 - Dec 8", inputs).ok).toBe(false);
  });
});

describe("breaks", () => {
  it("skips class meetings in a break the syllabus lists, and asks nothing about breaks", () => {
    const { plan } = clean([schedule, syllabus()]);
    const lec = plan.classes[0];
    // MWF in Nov 25-29: Wed 25 and Fri 27.
    expect(lec.skip_dates.map((s) => s.date)).toEqual(["2026-11-25", "2026-11-27"]);
    expect(plan.questions.find((q) => q.id === "q_breaks")).toBeUndefined();
  });

  it("asks once when nothing lists breaks; the answer becomes skipped meetings", () => {
    const first = clean([schedule, syllabus({ breaks: false })]);
    const q = first.plan.questions.filter((x) => x.id === "q_breaks");
    expect(q).toHaveLength(1);
    expect(first.plan.classes[0].skip_dates).toEqual([]);

    const typed = clean(
      [schedule, syllabus({ breaks: false })],
      [{ question_id: "q_breaks", option_id: "edit", value: "Nov 25-29" }],
    );
    expect(typed.plan.classes[0].skip_dates.map((s) => s.date)).toEqual(["2026-11-25", "2026-11-27"]);
    expect(typed.plan.questions.find((x) => x.id === "q_breaks")).toBeUndefined();

    const none = clean([schedule, syllabus({ breaks: false })], [{ question_id: "q_breaks", option_id: "none" }]);
    expect(none.plan.term_breaks.check.status).toBe("verified");
    expect(none.plan.classes[0].skip_dates).toEqual([]);
  });

  it("a typed break that isn't a date range is refused, with the reason", () => {
    const s = planFrom([schedule, syllabus({ breaks: false })], {
      zone: ZONE,
      answers: [{ question_id: "q_breaks", option_id: "edit", value: "sometime in fall" }],
    });
    expect(s.errors.q_breaks).toBeTruthy();
    expect(s.plan.questions.some((q) => q.id === "q_breaks")).toBe(true);
  });
});

describe("answers replay", () => {
  it("the first day of classes, answered, resolves 'Week 7 Thu' and the first meetings", () => {
    const rs = [schedule, syllabus({ term: false })];
    expect(buildPlan(rs, { zone: ZONE }).items.find((i) => i.title === "Problem Set 5")!.date).toBeNull();
    const { plan } = clean(rs, [{ question_id: "q_term_start", option_id: "edit", value: "2026-08-31" }]);
    expect(plan.items.find((i) => i.title === "Problem Set 5")!.date?.value).toBe("2026-10-15");
    expect(plan.classes[0].first_date?.value).toBe("2026-08-31");
    expect(plan.term_start.date?.trace.rule).toBe("answer");
  });

  it("'two different items' keeps both, each with its own date", () => {
    const moved = board("quiz moved to Mon", { title: "quiz", date_text: "Mon", change_text: "moved to" });
    const rs = [syllabus(), moved];
    const first = clean(rs);
    const conflict = first.plan.questions.find((q) => q.type === "conflict")!;
    expect(conflict.options.map((o) => o.id)).toContain("different");
    const { plan } = clean(rs, [{ question_id: conflict.id, option_id: "different" }]);
    expect(plan.items.find((i) => i.title === "Quiz 3")!.date?.value).toBe("2026-10-30");
    expect(plan.items.find((i) => i.title === "quiz")!.date?.value).toBe("2026-11-02");
    expect(plan.questions.some((q) => q.type === "conflict")).toBe(false);
  });

  it("an edit settles an item and its questions; a skip leaves it out", () => {
    const rs = [syllabus()];
    const quiz = buildPlan(rs, { zone: ZONE }).items.find((i) => i.title === "Quiz 3")!;
    const { plan } = clean(rs, [
      { question_id: `edit:${quiz.id}`, option_id: "edit", value: JSON.stringify({ time: "10am" }) },
      { question_id: `skip:${quiz.id}`, option_id: "skip" },
    ]);
    const q = plan.items.find((i) => i.id === quiz.id)!;
    expect(q.time?.start).toBe("10:00");
    expect(q.time?.trace.rule).toBe("answer");
    expect(plan.skipped).toEqual([quiz.id]);
  });

  it("drops answers to questions that no longer exist", () => {
    const s = clean([syllabus()], [{ question_id: "q_nope", option_id: "x" }]);
    expect(s.applied).toEqual([]);
  });
});
