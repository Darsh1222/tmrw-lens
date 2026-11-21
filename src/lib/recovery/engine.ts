import { z } from "zod";
import { DateTime } from "luxon";
import { RebuildRequest, type RebuildPlanned } from "@/lib/rebuild/contract";
import { Draft } from "@/lib/rebuild/draft";

const MIN = 60_000;
export const Obstacles = ["unsure", "stuck", "tired", "interrupted", "underestimated"] as const;
export type Obstacle = (typeof Obstacles)[number];
export const Memory = z.object({
  version: z.literal(1),
  preferDaytime: z.boolean(),
  history: z
    .array(
      z.object({
        id: z.string().max(80),
        category: z.string().min(1).max(60),
        estimated: z.number().int().min(5).max(600),
        actual: z.number().int().min(1).max(1200),
        at: z.iso.datetime({ offset: true }),
      }),
    )
    .max(100),
  rejected: z
    .array(z.object({ id: z.string().max(80), hour: z.number().int().min(0).max(23), reason: z.string().max(140) }))
    .max(50),
});
export type Memory = z.infer<typeof Memory>;
export const emptyMemory = (): Memory => ({ version: 1, preferDaytime: false, history: [], rejected: [] });
export const RecoveryInput = z
  .object({
    request: RebuildRequest,
    obstacle: z.enum(Obstacles),
    budget: z.number().int().min(5).max(120),
    category: z.string().trim().min(1).max(60),
    useEstimates: z.boolean(),
    allowOneMove: z.boolean(),
    memory: Memory,
  })
  .superRefine(({ request: r }, ctx) => {
    const now = Date.parse(r.now);
    const intervals = [...r.open_windows, ...r.fixed];
    if (intervals.some((w) => Date.parse(w.end) <= Date.parse(w.start)))
      ctx.addIssue({ code: "custom", message: "Every window and fixed event must end after it starts." });
    const times = [
      ...intervals.map((w) => Date.parse(w.end)),
      ...r.items.flatMap((i) => [Date.parse(i.end), ...(i.due ? [Date.parse(i.due)] : [])]),
      ...r.deadlines.map((d) => Date.parse(d.due)),
    ];
    if (Math.max(now, ...times) - now > 15 * 86400000)
      ctx.addIssue({ code: "custom", message: "Load at most 14 days of future availability and deadlines." });
    if (r.items.filter((i) => i.status === "missed").length !== 1)
      ctx.addIssue({
        code: "custom",
        message: "Recover one missed task at a time; include other tasks as scheduled commitments.",
      });
  });
export type RecoveryInput = z.infer<typeof RecoveryInput>;
export type Placement = {
  itemId: string;
  title: string;
  start: string;
  end: string;
  minutes: number;
  starter: boolean;
};
export type Proposal = {
  id: string;
  title: string;
  why: string;
  tradeoff: string;
  placements: Placement[];
  moved: Placement[];
  required: number;
  remaining: number;
  otherChanges: number;
};
export type RecoveryResult = {
  estimate: ReturnType<typeof estimateEffort>;
  proposals: Proposal[];
  availableMinutes: number;
  longestMinutes: number;
  shortfallMinutes: number;
  horizon: string;
  message: string;
  nextStep: string;
};

/** Text suggests a label only. The UI always lets the person correct it. */
export function suggestObstacle(text: string): Obstacle {
  if (/\b(not tired|not exhausted|not stuck|not confused|not interrupted)\b/i.test(text)) return "unsure";
  if (/\b(exhausted|tired|too much|overwhelmed)\b/i.test(text)) return "tired";
  if (/\b(stuck|confused|don.t understand|where to start)\b/i.test(text)) return "stuck";
  if (/\b(took longer|underestimated|more time)\b/i.test(text)) return "underestimated";
  if (/\b(interrupted|ran late|practice|meeting|shift)\b/i.test(text)) return "interrupted";
  return "unsure";
}

/** Median of the last ten explicitly recorded, same-category completion ratios. No demographic or cross-user inference. */
export function estimateEffort(base: number, category: string, memory: Memory, enabled: boolean) {
  const samples = memory.history.filter((h) => h.category.toLowerCase() === category.trim().toLowerCase()).slice(-10);
  const ratios = samples.map((h) => Math.max(0.5, Math.min(2, h.actual / h.estimated))).sort((a, b) => a - b);
  const middle = Math.floor(ratios.length / 2);
  const factor = ratios.length ? (ratios.length % 2 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2) : 1;
  const used = enabled && samples.length >= 3;
  return {
    base,
    minutes: used ? Math.min(600, Math.ceil((base * factor) / 5) * 5) : base,
    factor,
    samples: samples.length,
    used,
  };
}

function normalized(input: RecoveryInput) {
  const missed = input.request.items.find((i) => i.id === input.request.missed.item_id)!;
  const base = Math.ceil((Date.parse(missed.end) - Date.parse(missed.start)) / (5 * MIN)) * 5;
  const estimate = estimateEffort(base, input.category, input.memory, input.useEstimates);
  // A working copy represents the remaining work; the source request is never mutated.
  const items = input.request.items.map((i) =>
    i.id !== missed.id
      ? i
      : { ...i, start: new Date(Date.parse(i.end) - estimate.minutes * MIN).toISOString(), min_minutes: 5 },
  );
  const request = { ...input.request, items };
  return { request, estimate, draft: new Draft(request) };
}
type Span = { s: number; e: number };
function available(d: Draft, item: RebuildPlanned, after: number) {
  const due = d.dueBy(item) ?? Infinity;
  return d
    .free(item.id)
    .map((w) => ({
      s: Math.ceil(Math.max(w.s, after) / (5 * MIN)) * 5 * MIN,
      e: Math.floor(Math.min(w.e, due) / (5 * MIN)) * 5 * MIN,
    }))
    .filter((w) => w.e - w.s >= 5 * MIN);
}
function placement(d: Draft, item: RebuildPlanned, s: number, minutes: number, starter = false): Placement {
  return {
    itemId: item.id,
    title: item.title,
    start: d.instant(s),
    end: d.instant(s + minutes * MIN),
    minutes,
    starter,
  };
}
function allocate(d: Draft, total: number, spans: Span[], first?: number): Placement[] {
  let left = total;
  const out: Placement[] = [];
  // Preserve entire sessions when possible. Starter is a deliberate split with a complete remaining-work plan.
  if (!first) {
    const whole = spans.find((w) => w.e - w.s >= total * MIN);
    if (whole) return [placement(d, d.missed, whole.s, total)];
  }
  for (const w of spans) {
    let start = w.s;
    let capacity = Math.floor((w.e - w.s) / MIN);
    while (capacity >= 5 && left > 0 && out.length < 8) {
      const take = Math.min(left, capacity, first && out.length === 0 ? first : Infinity);
      if (take < 5) break;
      out.push(placement(d, d.missed, start, take, !!first && out.length === 0));
      start += take * MIN;
      capacity -= take;
      left -= take;
      // A starter is a separate first action. Leave a real 10-minute break before remaining work.
      if (first && out.length === 1) {
        start += 10 * MIN;
        capacity -= 10;
      }
      if (!first) break;
    }
    if (!left || out.length >= 8) break;
  }
  return out;
}

/** Independent final check: covers every placement and displaced task together, against the loaded hard rules. */
export function proposalProblems(raw: RecoveryInput, proposal: Proposal): string[] {
  const input = RecoveryInput.parse(raw);
  const { draft: d, estimate } = normalized(input);
  const problems: string[] = [];
  const movedIds = new Set(proposal.moved.map((p) => p.itemId));
  if (movedIds.size !== proposal.moved.length || proposal.moved.length > (input.allowOneMove ? 1 : 0))
    problems.push("Too many other commitments changed.");
  for (const id of movedIds) {
    const i = d.item(id);
    if (!i || i.id === d.missed.id || i.status !== "planned") problems.push("Unknown movable task.");
    else d.changes.set(id, { action: "move", start: Date.parse(i.start), end: Date.parse(i.end), reason: "preview" });
  }
  // Free each displaced task's original slot, then check the combined final schedule below.
  for (const id of movedIds) d.changes.set(id, { action: "drop", reason: "working copy only" });
  const all = [...proposal.placements, ...proposal.moved];
  for (const p of all) {
    const item = d.item(p.itemId);
    const s = Date.parse(p.start),
      e = Date.parse(p.end);
    if (
      !item ||
      !Number.isFinite(s) ||
      !Number.isFinite(e) ||
      e <= s ||
      s % (5 * MIN) !== 0 ||
      (e - s) / MIN !== p.minutes
    ) {
      problems.push("Invalid session.");
      continue;
    }
    if (proposal.placements.includes(p) && p.itemId !== d.missed.id) problems.push("Wrong recovered task.");
    if (p.starter && (p.minutes > input.budget || p.itemId !== d.missed.id))
      problems.push("The first step exceeds its budget.");
    if (p.minutes < 5 || d.ruleProblem({ s, e }) || s < d.now || (d.dueBy(item) !== null && e > d.dueBy(item)!))
      problems.push("A hard rule was broken.");
    if (!d.free(item.id).some((w) => w.s <= s && e <= w.e)) problems.push("Outside available time.");
    if (
      input.memory.preferDaytime &&
      (d.local(s).hour >= 21 || d.local(e).toMillis() > d.local(s).startOf("day").set({ hour: 21 }).toMillis())
    )
      problems.push("Outside the explicit daytime preference.");
  }
  for (let a = 0; a < all.length; a++)
    for (let b = a + 1; b < all.length; b++)
      if (Date.parse(all[a].start) < Date.parse(all[b].end) && Date.parse(all[b].start) < Date.parse(all[a].end))
        problems.push("Sessions overlap.");
  for (const p of proposal.moved) {
    const item = d.item(p.itemId);
    if (item && p.minutes !== d.length(item)) problems.push("Other work was shortened.");
  }
  if (
    proposal.placements.reduce((n, p) => n + p.minutes, 0) !== estimate.minutes ||
    proposal.required !== estimate.minutes ||
    proposal.remaining !== 0
  )
    problems.push("Some required work is missing.");
  return problems;
}

export function recover(raw: RecoveryInput): RecoveryResult {
  const input = RecoveryInput.parse(raw);
  const { request, draft: d, estimate } = normalized(input);
  const tomorrow = DateTime.fromMillis(d.now, { zone: request.zone }).plus({ days: 1 }).startOf("day").toMillis();
  // Explicit preference, never silently learned. Clip windows at 21:00, including those crossing midnight.
  const clipDaytime = (spans: Span[]) =>
    !input.memory.preferDaytime
      ? spans
      : spans.flatMap((w) => {
          const out: Span[] = [];
          for (let day = d.local(w.s).startOf("day"); day.toMillis() < w.e; day = day.plus({ days: 1 })) {
            const s = Math.max(w.s, day.toMillis()),
              e = Math.min(w.e, day.set({ hour: 21 }).toMillis());
            if (e - s >= 5 * MIN) out.push({ s, e });
          }
          return out;
        });
  const spans = clipDaytime(available(d, d.missed, d.now));
  const availableMinutes = spans.reduce((n, w) => n + (w.e - w.s) / MIN, 0);
  const proposals: Proposal[] = [];
  const add = (
    id: string,
    title: string,
    why: string,
    tradeoff: string,
    engine: Draft,
    windows: Span[],
    starter?: number,
    moved: Placement[] = [],
  ) => {
    // Rejections influence ordering only. They never remove necessary options or alter hard rules.
    const ordered =
      id === "balanced"
        ? [...windows].sort((a, b) => {
            const penalty = (w: Span) => input.memory.rejected.filter((r) => r.hour === d.local(w.s).hour).length;
            return penalty(a) - penalty(b) || a.s - b.s;
          })
        : windows;
    const placements = allocate(engine, estimate.minutes, ordered, starter).sort(
      (a, b) => Date.parse(a.start) - Date.parse(b.start),
    );
    const proposal = {
      id,
      title,
      why,
      tradeoff,
      placements,
      moved,
      required: estimate.minutes,
      remaining: Math.max(0, estimate.minutes - placements.reduce((n, p) => n + p.minutes, 0)),
      otherChanges: moved.length,
    };
    if (
      !proposalProblems(input, proposal).length &&
      !proposals.some((p) => JSON.stringify([p.placements, p.moved]) === JSON.stringify([placements, moved]))
    )
      proposals.push(proposal);
  };
  add(
    "balanced",
    "Keep other plans fixed",
    "Recover the work without moving another commitment.",
    "Uses your loaded free windows; rejected start hours are tried later.",
    d,
    spans,
  );
  if (input.obstacle === "stuck" || input.obstacle === "tired")
    add(
      "starter",
      "Start small, keep the remainder",
      "A small first action followed by a complete plan for the remaining work.",
      "More sessions, with a 10-minute break after the first step.",
      d,
      spans,
      Math.min(input.budget, input.obstacle === "stuck" ? 10 : 15, estimate.minutes),
    );
  add(
    "tomorrow",
    "Keep the rest of today free",
    "Try recovery from tomorrow without moving other commitments.",
    "Leaves less time before the deadline; unavailable if the full work cannot fit.",
    d,
    clipDaytime(available(d, d.missed, tomorrow)),
  );
  if (input.allowOneMove && proposals.length < 3) {
    outer: for (const item of request.items.filter((i) => i.status === "planned" && Date.parse(i.start) >= d.now)) {
      const other = new Draft(request);
      const options = clipDaytime(available(other, item, d.now))
        .filter((w) => w.e - w.s >= other.length(item) * MIN && w.s !== Date.parse(item.start))
        .slice(0, 6);
      for (const w of options) {
        const p = placement(other, item, w.s, other.length(item));
        other.changes.set(item.id, {
          action: "move",
          start: w.s,
          end: w.s + p.minutes * MIN,
          reason: "make room, pending confirmation",
        });
        add(
          "make-room",
          "Move one flexible task",
          "Preview one additional change to make room.",
          `Moves ${item.title}. Classes, sleep, and deadlines stay fixed.`,
          other,
          clipDaytime(available(other, other.missed, d.now)),
          undefined,
          [p],
        );
        if (proposals.some((p) => p.id === "make-room")) break outer;
      }
    }
  }
  const noFit = !proposals.length;
  return {
    estimate,
    proposals,
    availableMinutes,
    longestMinutes: Math.max(0, ...spans.map((w) => (w.e - w.s) / MIN)),
    shortfallMinutes: Math.max(0, estimate.minutes - availableMinutes),
    horizon: request.open_windows.map((w) => w.end).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? request.now,
    message: noFit
      ? "No complete recovery fits the loaded windows under these settings. Nothing has been dropped or moved."
      : "Compare complete plans. Nothing changes until you apply one.",
    nextStep:
      input.obstacle === "stuck"
        ? "Open the task and write the first question you cannot answer. Choose one small step; this does not claim the assignment is finished."
        : input.obstacle === "tired"
          ? "Choose whether to stop for today or try a short session. A free slot does not mean you must use it."
          : input.obstacle === "underestimated"
            ? "Update the remaining estimate before comparing plans. Record actual time after completion to improve future estimates."
            : input.obstacle === "interrupted"
              ? "Check your availability includes the interruption, then compare the smallest changes."
              : "Choose the obstacle that best fits, or keep it unspecified. Lens does not infer a diagnosis from your reply.",
  };
}
