import { DateTime } from "luxon";
import { norm, shortHash } from "@/lib/plan/text";
import { ok, type Candidate, type Check, type Conflict, type PlanItem, type Question } from "@/lib/plan/types";
import { worst } from "@/lib/plan/verify";
import { formatDate } from "@/lib/resolve/dates";

// Cross-source merge. Readings of the same item from different sources become
// one item with all their evidence ("Quiz Fri" on a whiteboard = "Quiz 3, Fri
// Oct 30" in the syllabus). When they disagree on the date or time, they are
// never merged silently: the item is marked "conflict", every version keeps its
// own evidence, and one question asks which is right, with the likely answer
// pre-selected and the reason for it shown.

type Relation = "same" | "maybe" | "different";

const days = (a: string, b: string) => Math.abs(DateTime.fromISO(a).diff(DateTime.fromISO(b), "days").days);

export function relation(a: Candidate, b: Candidate): Relation {
  if (a.kind !== b.kind || !a.course || a.course !== b.course || a.family !== b.family) return "different";
  const sameDate = !!a.date && !!b.date && a.date.value === b.date.value;
  if (a.family === null) return sameDate && norm(a.title) === norm(b.title) ? "same" : "different";
  if (a.number !== null && b.number !== null) return a.number === b.number ? "same" : "different";
  if (sameDate) return "same";
  if (a.number === null && b.number === null) return "different";
  // One says "Quiz 3", the other just "quiz": the same quiz if it says it moved, or if it's within a week.
  const loose = a.number === null ? a : b;
  const numbered = loose === a ? b : a;
  if (loose.change_text) return "maybe";
  if (loose.date && numbered.date && days(loose.date.value, numbered.date.value) <= 7) return "maybe";
  return "different";
}

const isPhoto = (c: Candidate) => c.source.kind === "whiteboard_photo" || c.source.kind === "notes_photo";
const sourceName = (c: Candidate) => c.source.label;

/** For an unnumbered item that says it moved, which numbered item it most likely means: the next one coming up. */
function bestTarget(loose: Candidate, options: Candidate[]): Candidate | null {
  if (!options.length) return null;
  const from = loose.date?.trace.inputs.photo_date ?? loose.date?.trace.inputs.added_date ?? null;
  const dated = options.filter((o) => o.date).sort((x, y) => x.date!.value.localeCompare(y.date!.value));
  if (loose.change_text && from) return dated.find((o) => o.date!.value >= from) ?? dated.at(-1) ?? options[0];
  if (loose.date) {
    const target = loose.date.value;
    return dated.sort((x, y) => days(x.date!.value, target) - days(y.date!.value, target))[0] ?? null;
  }
  return null;
}

function clusters(cands: Candidate[], separate: [string, string][] = []): { members: Candidate[]; maybe: boolean }[] {
  const apart = new Set(separate.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  const parent = cands.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const maybeRoots = new Set<number>();
  // Two readings from one source are two items, unless they're the same numbered item (e.g. on two PDF pages).
  const sameSourceOk = (a: Candidate, b: Candidate) =>
    a.source.id !== b.source.id || (a.number !== null && relation(a, b) === "same");

  for (let i = 0; i < cands.length; i++)
    for (let j = i + 1; j < cands.length; j++)
      if (sameSourceOk(cands[i], cands[j]) && relation(cands[i], cands[j]) === "same") parent[find(i)] = find(j);

  // A loose reading joins at most one numbered item, and only if it hasn't already matched one exactly.
  cands.forEach((loose, i) => {
    if (loose.number !== null) return;
    const rootHasNumber = cands.some((c, k) => find(k) === find(i) && c.number !== null);
    if (rootHasNumber) return;
    // The person said they're two different items: never offered as a match again.
    const options = cands.filter(
      (c) => c.source.id !== loose.source.id && relation(loose, c) === "maybe" && !apart.has(`${loose.id}|${c.id}`),
    );
    const target = bestTarget(loose, options);
    if (!target) return;
    parent[find(i)] = find(cands.indexOf(target));
    maybeRoots.add(find(i));
  });

  const groups = new Map<number, Candidate[]>();
  cands.forEach((c, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), c]));
  const maybe = new Set([...maybeRoots].map(find));
  return [...groups.entries()].map(([root, members]) => ({ members, maybe: maybe.has(root) }));
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = ((h + 11) % 12) + 1;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

function describe(v: { date: string | null; time: string | null }): string {
  return [v.date && formatDate(v.date), v.time && formatTime(v.time)].filter(Boolean).join(", ") || "no date";
}

/**
 * Which version is likely right. A source that says it changed ("moved to") wins; then a photo of a
 * whiteboard or notes over a document, because it's usually the newer word. Always returns a reason.
 */
function suggest(versions: { c: Candidate; i: number }[]): { index: number; why: string } {
  const score = (c: Candidate) => (c.change_text ? 2 : 0) + (isPhoto(c) && c.source.captured_at ? 1 : 0);
  const best = [...versions].sort((x, y) => score(y.c) - score(x.c))[0];
  const others = versions.filter((v) => v !== best).map((v) => sourceName(v.c));
  const s = score(best.c);
  if (s === 0) {
    const official = versions.find((v) => !isPhoto(v.c)) ?? best;
    return {
      index: official.i,
      why: `The ${sourceName(official.c)} is the official schedule, and nothing here says it changed.`,
    };
  }
  const taken = best.c.source.captured_at
    ? ` was taken ${DateTime.fromISO(best.c.source.captured_at, { setZone: true }).toFormat("ccc MMM d")}`
    : "";
  const why = best.c.change_text
    ? `The ${sourceName(best.c)}${taken} and says "${best.c.change_text}".`
    : `The ${sourceName(best.c)}${taken}, and what's written by hand is usually newer than the ${others.join(" and ")}.`;
  return { index: best.i, why };
}

export function merge(
  cands: Candidate[],
  { separate }: { separate?: [string, string][] } = {},
): { items: PlanItem[]; questions: Question[] } {
  const items: PlanItem[] = [];
  const questions: Question[] = [];

  for (const { members, maybe } of clusters(cands, separate)) {
    // Documents first, then photos oldest to newest, so the official wording names the item.
    const ordered = [...members].sort(
      (a, b) =>
        Number(isPhoto(a)) - Number(isPhoto(b)) ||
        (a.source.captured_at ?? "").localeCompare(b.source.captured_at ?? ""),
    );
    const primary = ordered.find((c) => c.number !== null) ?? ordered[0];
    const id = `item_${shortHash(ordered.map((c) => c.id).join("|"))}`;

    const dated = ordered.filter((c) => c.date);
    const timed = ordered.filter((c) => c.time);
    const dateValues = new Set(dated.map((c) => c.date!.value));
    const timeValues = new Set(timed.map((c) => c.time!.start));
    const fields: Conflict["fields"] = [];
    if (dateValues.size > 1) fields.push("date");
    if (timeValues.size > 1) fields.push("time");

    let conflict: Conflict | null = null;
    if (fields.length || (maybe && members.length > 1)) {
      // One version per source that states the date or time, de-duplicated by what it says.
      const seen = new Set<string>();
      const versions: { c: Candidate; i: number }[] = [];
      for (const c of ordered) {
        if (!c.date && !c.time) continue;
        const key = `${c.date?.value}|${c.time?.start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        versions.push({ c, i: versions.length });
      }
      conflict = {
        fields: fields.length ? fields : ["date"],
        versions: versions.map(({ c }) => ({
          candidate_id: c.id,
          date: c.date,
          time: c.time,
          evidence: c.evidence,
        })),
        maybe_different: maybe,
        chosen: null,
      };
      const pick = suggest(versions);
      const said = versions.map(
        ({ c }) =>
          `the ${sourceName(c)} says ${describe({ date: c.date?.value ?? null, time: c.time?.start ?? null })}`,
      );
      questions.push({
        id: `q_${id}_conflict`,
        about: id,
        type: "conflict",
        prompt: `${primary.title}: ${said.join(", but ")}. Which is right?`,
        options: [
          ...versions.map(({ c, i }) => ({
            id: `v${i}`,
            label: `${describe({ date: c.date?.value ?? null, time: c.time?.start ?? null })} (${sourceName(c)})`,
            value: [c.date?.value, c.time?.start].filter(Boolean).join("T"),
            evidence: c.evidence,
          })),
          ...(maybe
            ? [{ id: "different", label: "They're two different items", value: "different", evidence: null }]
            : []),
        ],
        input: null,
        suggested: `v${pick.index}`,
        why_suggested: pick.why,
      });
    }

    const conflictCheck: Check = { status: "conflict", reason: "The sources disagree." };
    const dateFrom = dated.find((c) => c.checks.date.status === "verified") ?? dated[0] ?? primary;
    const timeFrom = timed.find((c) => c.time?.end) ?? timed[0] ?? primary;
    const dateConflict = conflict && (conflict.fields.includes("date") || conflict.maybe_different);
    const timeConflict = conflict?.fields.includes("time");
    const quote = members.some((c) => c.checks.quote.status === "verified")
      ? ok
      : worst(...members.map((c) => c.checks.quote));
    const checks = {
      quote,
      title: primary.checks.title,
      course: primary.checks.course,
      date: dateConflict ? conflictCheck : dateFrom.checks.date,
      time: timeConflict ? conflictCheck : timeFrom.checks.time,
    };
    items.push({
      id,
      kind: primary.kind,
      title: primary.title,
      course: primary.course,
      family: primary.family,
      number: primary.number,
      date: dateConflict ? null : (dateFrom.date ?? null),
      time: timeConflict ? null : (timeFrom.time ?? null),
      evidence: ordered.map((c) => c.evidence),
      candidates: ordered.map((c) => c.id),
      checks,
      conflict,
      depends_on: null,
      status: worst(...Object.values(checks)).status,
    });
  }
  return { items, questions };
}
