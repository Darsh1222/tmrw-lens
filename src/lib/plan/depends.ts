import { familyOf } from "@/lib/plan/courses";
import { contains, norm } from "@/lib/plan/text";
import { ok, type Candidate, type Check, type PlanItem, type Question } from "@/lib/plan/types";
import { worst } from "@/lib/plan/verify";
import { formatDate, parseRelative, resolveDate } from "@/lib/resolve/dates";

// Dates written relative to another item: "before Midterm 1", "the week after
// the project". The item it means is found in the plan, the date is that
// item's date plus the offset, and the link is kept, so when that item moves
// (a conflict answered, a date picked) everything that depends on it moves too.
// Only when the item can't be found, or could be more than one, is there a
// question.

type Found = { item: PlanItem } | { ambiguous: PlanItem[] } | { none: true };

/** The item a relative date points at, among items of the same course when the dependent has one. */
export function findRef(refText: string, dependent: PlanItem, items: PlanItem[]): Found {
  const ref = refText.replace(/^(the|my|our|your)\s+/i, "");
  const pool = items.filter((i) => i.id !== dependent.id && (!dependent.course || i.course === dependent.course));
  const f = familyOf(ref);
  const hits = f.family
    ? pool.filter((i) => i.family === f.family && (f.number === null || i.number === f.number))
    : pool.filter((i) => norm(i.title) === norm(ref));
  if (hits.length === 1) return { item: hits[0] };
  if (hits.length > 1) return { ambiguous: hits };
  return { none: true };
}

/** Links every item whose date is relative to another; returns the questions for the ones that can't be placed. */
export function linkDependents(items: PlanItem[], byId: Map<string, Candidate>): Question[] {
  const questions: Question[] = [];
  for (const item of items) {
    if (item.date || item.conflict) continue;
    const c = item.candidates.map((id) => byId.get(id)!).find((x) => x.date_needs?.needs === "reference");
    const rel = c?.date_text ? parseRelative(c.date_text) : null;
    if (!c || !rel) continue;
    const found = findRef(rel.ref, item, items);
    if ("item" in found) {
      item.depends_on = { item_id: found.item.id, text: c.date_text!, offset_days: rel.offset_days };
      continue;
    }
    const options = "ambiguous" in found ? found.ambiguous : [];
    item.depends_on = { item_id: null, text: c.date_text!, offset_days: rel.offset_days };
    item.checks.date = {
      status: "needs_question",
      reason: options.length ? `"${rel.ref}" could be ${options.length} items.` : `I can't find "${rel.ref}".`,
    };
    item.status = worst(...Object.values(item.checks)).status;
    questions.push({
      id: `q_${item.id}_which_item`,
      about: item.id,
      type: "which_item",
      prompt: options.length
        ? `"${item.title}" is due ${c.date_text}. Which one is that?`
        : `When is "${item.title}"? It says ${c.date_text}, and I can't find ${rel.ref} in what you added.`,
      options: [
        ...options.map((o) => ({
          id: o.id,
          label: o.date ? `${o.title} (${formatDate(o.date.value)})` : o.title,
          value: `item:${o.id}`,
          evidence: o.evidence[0] ?? null,
        })),
        { id: "edit", label: "Pick the date", value: null, evidence: null },
      ],
      suggested: null,
      why_suggested: null,
    });
  }
  return questions;
}

/**
 * Recomputes every dependent's date (and, for "before X", its time: X's start) from the item it points at, in
 * dependency order. A dependent whose item has no date yet waits on it, with no question of its own.
 */
export function propagate(items: PlanItem[]): void {
  const byId = new Map(items.map((i) => [i.id, i]));
  const done = new Set<string>();
  const visit = (item: PlanItem, path: Set<string>) => {
    if (!item.depends_on?.item_id || done.has(item.id)) return;
    const ref = byId.get(item.depends_on.item_id);
    if (!ref || path.has(ref.id)) {
      item.date = null;
      item.checks.date = { status: "needs_question", reason: `"${item.depends_on.text}" goes in a circle.` };
    } else {
      visit(ref, new Set([...path, item.id]));
      place(item, ref);
    }
    item.status = worst(...Object.values(item.checks)).status;
    done.add(item.id);
  };
  for (const item of items) visit(item, new Set());
}

function place(item: PlanItem, ref: PlanItem) {
  const dep = item.depends_on!;
  const evidence = item.evidence.find((e) => contains(e.quote, dep.text)) ?? item.evidence[0];
  if (!ref.date) {
    item.date = null;
    if (item.time?.trace.rule === "before_item") item.time = null;
    const waiting = ref.conflict ? `the ${ref.title} question` : `${ref.title}'s date`;
    item.checks.date = { status: "needs_question", reason: `Waits on ${waiting}.` };
    return;
  }
  const inputs = {
    term_start: null,
    photo_date: null,
    added_date: null,
    ref: { item_id: ref.id, date: ref.date.value },
  };
  const r = resolveDate(dep.text, inputs);
  if (!r.ok) return; // can't happen: the text resolved against a reference when it was linked
  item.date = { value: r.date, trace: { text: dep.text, evidence, rule: r.rule, inputs } };
  const settled = ref.checks.date.status === "verified";
  item.checks.date = settled
    ? ok
    : ({ status: "needs_question", reason: `Moves with ${ref.title}, which isn't settled yet.` } satisfies Check);
  // Due "before" an exam that has a start time means before it starts.
  const inherited = !item.time || item.time.trace.rule === "before_item";
  if (dep.offset_days === 0 && inherited && ref.time) {
    item.time = {
      start: ref.time.start,
      end: null,
      trace: { text: dep.text, evidence, rule: "before_item", class_id: null, item_id: ref.id },
    };
    item.checks.time =
      ref.checks.time.status === "verified"
        ? ok
        : { status: "needs_question", reason: `Moves with ${ref.title}, which isn't settled yet.` };
  } else if (item.time?.trace.rule === "before_item") {
    item.time = null;
    item.checks.time = ok;
  }
}
