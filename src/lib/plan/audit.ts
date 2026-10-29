import { contains } from "@/lib/plan/text";
import type { DateTrace, Plan, SourceMeta, TracedDate, TracedTime } from "@/lib/plan/types";
import { firstMeeting, localDate, parseDays, parseTime, resolveDate } from "@/lib/resolve/dates";

// "Invented dates: 0". Every date in a plan (the term start, each item, each
// class's first meeting, each version in a conflict) must trace to words that
// are inside its quote, and recomputing it from those words and the recorded
// inputs must give the same date. The inputs themselves must be real: the
// plan's own term start, or the day a source was photographed or added.
// Times get the same treatment. Send runs this too, and refuses on any failure.

export type Finding = { about: string; field: string; value: string; why: string };
export type DateAudit = { dates: number; times: number; invented: Finding[] };

export function auditPlan(plan: Plan, sources: SourceMeta[]): DateAudit {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const invented: Finding[] = [];
  let dates = 0;
  let times = 0;

  const checkDate = (about: string, field: string, d: TracedDate, isTerm = false) => {
    dates++;
    const why = dateProblem(d.trace, d.value, isTerm);
    if (why) invented.push({ about, field, value: d.value, why });
  };

  function dateProblem(t: DateTrace, value: string, isTerm: boolean): string | null {
    if (!contains(t.evidence.quote, t.text)) return `"${t.text}" isn't in its quote`;
    const src = byId.get(t.evidence.source_id);
    if (!src) return `unknown source ${t.evidence.source_id}`;
    const term = plan.term_start.date?.value ?? null;
    if (t.inputs.term_start !== null && (isTerm || t.inputs.term_start !== term)) return "term start isn't the plan's";
    if (
      t.inputs.photo_date !== null &&
      (!src.captured_at || t.inputs.photo_date !== localDate(src.captured_at, plan.zone))
    )
      return "photo date isn't the source's";
    if (t.inputs.added_date !== null && t.inputs.added_date !== localDate(src.added_at, plan.zone))
      return "added date isn't the source's";
    if (t.rule === "first_meeting") {
      const days = parseDays(t.text);
      if (!days?.length || !t.inputs.term_start) return "can't recompute the first meeting";
      return firstMeeting(days, t.inputs.term_start) === value ? null : "first meeting doesn't recompute";
    }
    const r = resolveDate(t.text, t.inputs);
    if (!r.ok) return `"${t.text}" doesn't resolve: ${r.reason}`;
    if (r.date !== value || r.rule !== t.rule) return `"${t.text}" recomputes to ${r.date}, not ${value}`;
    return null;
  }

  const checkTime = (about: string, tt: TracedTime) => {
    times++;
    const t = tt.trace;
    const fail = (why: string) => invented.push({ about, field: "time", value: tt.start, why });
    if (!contains(t.evidence.quote, t.text)) return fail(`"${t.text}" isn't in its quote`);
    if (t.rule === "in_class") {
      const b = plan.classes.find((c) => c.id === t.class_id);
      if (!b || b.start !== tt.start || b.end !== tt.end) fail("doesn't match the class it came from");
      return;
    }
    const p = parseTime(t.text);
    if (!p.ok || p.kind !== "clock" || p.start !== tt.start || p.end !== tt.end) fail(`"${t.text}" doesn't recompute`);
  };

  if (plan.term_start.date) checkDate("term", "term_start", plan.term_start.date, true);
  for (const c of plan.classes) if (c.first_date) checkDate(c.id, "first_date", c.first_date);
  for (const item of plan.items) {
    if (item.date) checkDate(item.id, "date", item.date);
    if (item.time) checkTime(item.id, item.time);
    for (const v of item.conflict?.versions ?? []) {
      if (v.date) checkDate(item.id, "conflict_date", v.date);
      if (v.time) checkTime(item.id, v.time);
    }
  }
  return { dates, times, invented };
}
