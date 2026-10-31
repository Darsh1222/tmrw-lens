import { formatTime } from "@/lib/plan/merge";
import type { Check, Plan, TracedDate, TracedTime } from "@/lib/plan/types";
import { formatDate, WEEKDAY_NAMES } from "@/lib/resolve/dates";

// The "computed from" line under every date and time: the words it was read
// from and the rule code applied, in plain words. Built from the trace alone,
// so it says exactly what the audit recomputes.

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ago = (days: number) =>
  days === 0 ? "the same day as" : days > 0 ? `${plural(days, "day")} after` : `${plural(-days, "day")} before`;

export function explainDate(d: TracedDate, plan: Plan): string {
  const t = d.trace;
  const said = `"${t.text}"`;
  const i = t.inputs;
  switch (t.rule) {
    case "answer":
      return "You gave this date.";
    case "week_of_term":
      return `${said}: week 1 is the week classes start (${i.term_start ? formatDate(i.term_start) : "?"}).`;
    case "month_day":
    case "numeric": {
      const year = d.value.slice(0, 4);
      return /\b\d{4}\b/.test(t.text) ? `${said}, as written.` : `${said}, in ${year}: the year of the term.`;
    }
    case "weekday_after":
      return `${said}: the next ${WEEKDAY_NAMES[new Date(`${d.value}T12:00:00Z`).getUTCDay() || 7]} after the photo was taken (${i.photo_date ? formatDate(i.photo_date) : "?"}).`; // prettier-ignore
    case "relative_day":
      return `${said}, counted from the day the photo was taken (${i.photo_date ? formatDate(i.photo_date) : "?"}).`;
    case "offset": {
      const ref = i.ref ? plan.items.find((x) => x.id === i.ref!.item_id) : null;
      const days = i.ref ? Math.round((Date.parse(d.value) - Date.parse(i.ref.date)) / 86_400_000) : 0;
      return ref && i.ref
        ? `${said}: ${ago(days)} ${ref.title} (${formatDate(i.ref.date)}).`
        : `${said}, counted from the date it names.`;
    }
    case "first_meeting":
      return `The first ${t.text} on or after the first day of classes (${i.term_start ? formatDate(i.term_start) : "?"}).`;
    case "last_meeting":
      return `The last ${t.text} on or before the last day of classes (${i.term_end ? formatDate(i.term_end) : "?"}).`;
  }
}

export function explainTime(tt: TracedTime, plan: Plan): string {
  const t = tt.trace;
  const range = `${formatTime(tt.start)}${tt.end ? `-${formatTime(tt.end)}` : ""}`;
  switch (t.rule) {
    case "answer":
      return "You gave this time.";
    case "clock":
      return `"${t.text}", as written.`;
    case "in_class": {
      const c = plan.classes.find((x) => x.id === t.class_id);
      return `"${t.text}": your ${c ? `${c.course} ${c.meeting_type}` : "class"} that day, ${range}.`;
    }
    case "before_item": {
      const ref = plan.items.find((x) => x.id === t.item_id);
      return `Due before ${ref?.title ?? "the item it names"} starts, ${formatTime(tt.start)}.`;
    }
  }
}

/** How a reading was checked, for a verified quote; otherwise why not. */
export function explainCheck(check: Check, kind: "photo" | "document" | "text"): string {
  if (check.status !== "verified") return check.reason ?? "Not confirmed yet.";
  if (check.reason) return check.reason;
  return kind === "photo"
    ? "Read twice: a second, separate read of the crop matches."
    : kind === "document"
      ? "Matches the page's own text."
      : "Matches the text you pasted.";
}
