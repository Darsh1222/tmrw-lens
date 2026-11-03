import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditPlan } from "@/lib/plan/audit";
import { buildPlan } from "@/lib/plan/build";
import { explainDate, explainTime } from "@/lib/plan/explain";
import { planFrom } from "@/lib/plan/session";
import type { SourceMeta, SourceReading } from "@/lib/plan/types";
import { parseDays, parseNotice, resolveDate } from "@/lib/resolve/dates";
import { itemImport, classImport } from "@/lib/tomorrow/contract";

// What a syllabus says beyond its dates, on the synthetic PHYS161 syllabus (in-class midterms on tentative dates, a
// TBA final, a 7-day notice rule, quizzes in discussion, office hours, weights, topics), from its recorded reading.

const ZONE = "America/New_York";
const syllabus = (): SourceReading => {
  const rec = JSON.parse(readFileSync("evals/recorded/syllabus-phys161-policies.pdf.json", "utf8"));
  const source: SourceMeta = { id: "syl", kind: "syllabus_pdf", label: "PHYS161 syllabus", captured_at: null, added_at: "2026-10-29T09:00:00-04:00" }; // prettier-ignore
  return { source, pages: rec.pages }; // a recorded page also carries its SAM reading, which plans ignore
};
const find = (plan: ReturnType<typeof buildPlan>, re: RegExp) => plan.items.find((i) => re.test(i.title))!;

describe("syllabus policies", () => {
  it("times an in-class exam from that day's lecture, labelled, with both quotes, and the audit recomputes it", () => {
    const plan = buildPlan([syllabus()], { zone: ZONE });
    const m2 = find(plan, /^Midterm 2$/);
    expect(m2.date?.value).toBe("2026-11-18");
    expect(m2.time).toMatchObject({ start: "13:00", end: "13:50", trace: { rule: "in_class", class_id: null } });
    expect(m2.time!.trace.text).toMatch(/in-class/i);
    expect(m2.time!.trace.lecture?.time_text).toMatch(/13:00 - 13:50/);
    expect(explainTime(m2.time!, plan)).toMatch(/^Time inferred from your lecture schedule/);
    expect(m2.status).toBe("verified");
    expect(auditPlan(plan, [syllabus().source]).invented).toEqual([]);
  });

  it("marks the exams tentative, and a later source's date is the likely one", () => {
    const syl = syllabus();
    const board: SourceReading = {
      source: { id: "wb", kind: "whiteboard_photo", label: "whiteboard photo", captured_at: "2026-11-02T10:00:00-05:00", added_at: "2026-11-02T10:00:00-05:00" }, // prettier-ignore
      pages: [
        {
          page: null,
          text: "PHYS161 Midterm 2 moved to Nov 20",
          extraction: { items: [{ kind: "exam", title: "Midterm 2", course_hint: "PHYS161", date_text: "Nov 20", time_text: null, change_text: "moved to", legible: "clear", evidence: { quote: "PHYS161 Midterm 2 moved to Nov 20", box: null } }] }, // prettier-ignore
          rereads: {},
        },
      ],
    };
    expect(find(buildPlan([syl], { zone: ZONE }), /^Midterm 1$/).tentative?.text).toMatch(/TENTATIVE/);
    const plan = buildPlan([syl, board], { zone: ZONE });
    const q = plan.questions.find((x) => x.type === "conflict")!;
    expect(q.options.find((o) => o.id === q.suggested)?.value).toBe("2026-11-20");
    expect(q.why_suggested).toMatch(/says its dates are "[^"]*TENTATIVE/);
  });

  it("keeps a TBA final undated, with one note to check back, and never a date", () => {
    const plan = buildPlan([syllabus()], { zone: ZONE });
    const final = find(plan, /^Final exam$/);
    expect(final).toMatchObject({ date: null, tba: true });
    const qs = plan.questions.filter((q) => q.about === final.id);
    expect(qs.map((q) => q.id)).toEqual([`q_${final.id}_tba`]);
    expect(qs[0].prompt).toMatch(/TBA.*near the last week/);
    expect(resolveDate("TBA", { term_start: "2026-08-31", photo_date: null, added_date: "2026-10-29" }).ok).toBe(false);
  });

  it("adds an optional notice task before each exam, with the date math, moving with the exam", () => {
    const plan = buildPlan([syllabus()], { zone: ZONE });
    const n2 = find(plan, /exam conflict \(Midterm 2\)/);
    expect(n2).toMatchObject({ kind: "task", optional: "Only if you have a conflict", date: { value: "2026-11-11" } });
    expect(explainDate(n2.date!, plan)).toMatch(/Wed Nov 18 \(Midterm 2\) - 7 days = Wed Nov 11/);
    expect(find(plan, /exam conflict \(Final exam\)/)).toMatchObject({ date: null, checks: { date: { reason: "Waits on Final exam's date." } } }); // prettier-ignore
    expect(itemImport(plan, [syllabus().source], n2).title).toMatch(/\(only if you have a conflict\)$/);
    // The final's date, once added, gives its notice a date too.
    const s = planFrom([syllabus()], { zone: ZONE, answers: [] });
    const final = find(s.plan, /^Final exam$/);
    const after = planFrom([syllabus()], { zone: ZONE, answers: [{ question_id: `q_${final.id}_tba`, option_id: "edit", value: "2026-12-14" }] }); // prettier-ignore
    expect(find(after.plan, /exam conflict \(Final exam\)/).date?.value).toBe("2026-12-07");
    expect(auditPlan(after.plan, after.sources).invented).toEqual([]);
  });

  it("asks which discussion quizzes are in, then marks its meetings, never inventing quiz dates", () => {
    const s = planFrom([syllabus()], { zone: ZONE, answers: [] });
    expect(s.plan.questions.find((q) => q.id === "q_quiz_section_PHYS161")?.prompt).toMatch(/^Which PHYS161 discussion section are you in\? Quizzes happen there/); // prettier-ignore
    expect(s.plan.items.filter((i) => /quiz/i.test(i.title))).toEqual([]);
    const after = planFrom([syllabus()], { zone: ZONE, answers: [{ question_id: "q_quiz_section_PHYS161", option_id: "edit", value: "0104" }] }); // prettier-ignore
    expect(after.plan.questions.some((q) => q.id === "q_quiz_section_PHYS161")).toBe(false);
    expect(after.plan.courses?.[0].quizzes?.section).toBe("0104");
  });

  it("asks before adding office hours; yes adds a weekly optional block", () => {
    const no = planFrom([syllabus()], { zone: ZONE, answers: [{ question_id: "q_office_hours_PHYS161", option_id: "no" }] }); // prettier-ignore
    expect(no.plan.classes).toEqual([]);
    const yes = planFrom([syllabus()], { zone: ZONE, answers: [{ question_id: "q_office_hours_PHYS161", option_id: "add" }] }); // prettier-ignore
    expect(yes.plan.classes).toHaveLength(1);
    expect(yes.plan.classes[0]).toMatchObject({ title: "Office hours", meeting_type: "other", days: [2, 4], start: "14:00", end: "15:00", marker: "Office hours (optional)" }); // prettier-ignore
    const facts = { office_hours: { PHYS161: { add: true, question: "q" } }, term_start: { date: "2026-08-31", question: "q_term_start" } }; // prettier-ignore
    const plan = buildPlan([syllabus()], { zone: ZONE, facts });
    expect(plan.classes[0].first_date?.value).toBe("2026-09-01");
    expect(classImport(plan, [syllabus().source], plan.classes[0]).title).toBe("PHYS161 office hours");
    expect(auditPlan(plan, [syllabus().source]).invented).toEqual([]);
  });

  it("keeps grade weights and topics as course info, not dates", () => {
    const info = buildPlan([syllabus()], { zone: ZONE }).courses?.find((c) => c.course === "PHYS161");
    expect(info?.weights.map((w) => `${w.component}: ${w.weight}`)).toContain("Final Exam: 35%");
    expect(info?.topics).toHaveLength(7);
  });

  it("reads notice periods and spelled-out days", () => {
    expect(parseNotice("at least one week (7 days) in advance")).toBe(7);
    expect(parseNotice("two weeks in advance")).toBe(14);
    expect(parseNotice("in writing")).toBeNull();
    expect(parseDays("Monday and Wednesday")).toEqual([1, 3]);
    expect(parseDays("Tuesday and Thursday")).toEqual([2, 4]);
  });
});
