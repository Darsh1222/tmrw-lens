"use client";

import {
  ArrowBendDownRight,
  ArrowCounterClockwise,
  CalendarBlank,
  CaretDown,
  Check,
  CheckCircle,
  MagnifyingGlass,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { Step } from "@/lib/rebuild/agent";
import type { Draft } from "@/lib/rebuild/draft";
import { money } from "../ui";
import { span, twelveHour } from "./week";

// "How Lens decided": the agent's tool calls, one row each, in plain English
// ("Found open time: Wed 7–10 PM, Thu 7:30–9:30 AM"), with the call itself in
// monospace when a row is opened. Rows appear as the run streams in; the list
// keeps room for six so the page below doesn't jump.

type Icon = typeof Check;

function plain(s: Step, d: Draft): { icon: Icon; label: string } {
  const a = (s.args && typeof s.args === "object" ? s.args : {}) as Record<string, unknown>;
  const r = s.result;
  const title = (id: unknown) => d.item(String(id))?.title ?? "it";
  const local = (v: unknown) => (typeof v === "string" && v !== "null" ? d.parseLocal(v) : null);
  const at = (v: unknown) => {
    const ms = local(v);
    return typeof ms === "number" ? `${d.local(ms).toFormat("ccc")} ${twelveHour(d.hhmm(ms))}` : "";
  };
  if (!s.ok) {
    const what = s.tool === "move_item" ? `Tried ${title(a.item_id)} at ${at(a.start)}` : s.tool === "propose_diff" ? "Checked again" : "Refused"; // prettier-ignore
    return { icon: WarningCircle, label: `${what}: ${twelveHour(String(r.problem))}` };
  }
  switch (s.tool) {
    case "get_day": {
      const ms = local(`${String(a.date)}T12:00`);
      return { icon: CalendarBlank, label: `Looked at ${typeof ms === "number" ? d.local(ms).toFormat("cccc") : String(a.date)}` }; // prettier-ignore
    }
    case "find_open_time": {
      // Ranked suggestions (agent v9+: free_from/free_until), or plain spans from older recordings (start/end).
      const free = ((r.free as { start?: string; end?: string; free_from?: string; free_until?: string }[]) ?? []).map((f) => ({ start: (f.free_from ?? f.start)!, end: (f.free_until ?? f.end)! })); // prettier-ignore
      if (!free.length) {
        const there = (r.planned_in_range as { title: string }[] | undefined)?.map((p) => p.title);
        return { icon: MagnifyingGlass, label: `No ${String(a.minutes)}-minute opening${there?.length ? `; ${there.join(", ")} could move` : ""}` }; // prettier-ignore
      }
      const spans = free.slice(0, 3).map((f) => {
        const s0 = local(f.start) as number;
        const s1 = local(f.end) as number;
        return `${d.local(s0).toFormat("ccc")} ${span(s0, s1, d.zone)}`;
      });
      return { icon: MagnifyingGlass, label: `Best open time: ${spans.join(", ")}${free.length > 3 ? ", …" : ""}` };
    }
    case "move_item": {
      const ms = local(a.start) as number;
      const mins = typeof a.duration_min === "number" ? a.duration_min : d.length(d.item(String(a.item_id))!);
      return { icon: ArrowBendDownRight, label: `Moved ${title(a.item_id)} to ${d.local(ms).toFormat("ccc")} ${span(ms, ms + mins * 60_000, d.zone)}` }; // prettier-ignore
    }
    case "drop_item":
      return { icon: X, label: `Dropped ${title(a.item_id)}` };
    case "undo_change":
      return { icon: ArrowCounterClockwise, label: `Put ${title(a.item_id)} back` };
    default:
      return { icon: CheckCircle, label: "Proposed the change" };
  }
}

const compact = (v: unknown) =>
  JSON.stringify(v)
    .replace(/"([a-z_]+)":/g, "$1: ")
    .slice(0, 400);

export function Trace({
  steps,
  shown,
  d,
  cost,
  seconds,
  source,
  thinking,
  reserve,
}: {
  steps: Step[];
  shown: number;
  d: Draft;
  cost: number;
  seconds: number;
  source: string;
  thinking: boolean;
  /** Keep room for the rows while a run streams in, so the page below doesn't jump. */
  reserve: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [detail, setDetail] = useState<number | null>(null);
  return (
    <section className="flex flex-col gap-2" aria-label="How Lens decided">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 self-start rounded-lg text-left text-sm font-medium"
      >
        <CaretDown
          size={16}
          weight="light"
          style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 200ms" }}
        />
        How Lens decided
        <span
          className="rounded-md px-2 py-0.5 text-xs font-normal"
          style={{ border: "1px solid var(--tm-border-strong)", color: "var(--tm-text-2)" }}
        >
          {shown ? `${money(cost)} · ${seconds.toFixed(1)}s · ${source}` : source}
        </span>
      </button>
      {open && (
        <ol className={`flex flex-col gap-1 ${reserve ? "min-h-[264px]" : ""}`}>
          {!reserve && (
            <li className="text-sm" style={{ color: "var(--tm-text-2)" }}>
              Each step Lens takes shows here as it happens: the days it looked at, the open time it found, and what it
              moved.
            </li>
          )}
          {thinking && !shown && (
            <li className="flex min-h-11 items-center gap-3 text-sm" style={{ color: "var(--tm-text-2)" }}>
              <span className="forum-typing flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--tm-text-2)" }} />
                ))}
              </span>
              Looking at the week
            </li>
          )}
          {steps.map((s, n) => {
            const { icon: Icon, label } = plain(s, d);
            const visible = n < shown;
            return (
              <li key={n} className={`forum-in ${visible ? "" : "forum-hidden hidden"}`}>
                <button
                  onClick={() => setDetail(detail === n ? null : n)}
                  aria-expanded={detail === n}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-1 text-left text-sm"
                >
                  <Icon
                    size={20}
                    weight="light"
                    style={{ color: s.ok ? "var(--tm-text-2)" : "var(--tm-crimson)", flexShrink: 0 }}
                  />
                  <span>{label}</span>
                </button>
                {detail === n && (
                  <pre
                    className="ml-8 overflow-x-auto whitespace-pre-wrap break-words rounded-lg p-3 font-mono text-xs"
                    style={{ background: "var(--tm-sunken)", color: "var(--tm-text-2)" }}
                  >
                    {`${s.tool}(${compact(s.args)})\n→ ${compact(s.result)}`}
                  </pre>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function Checks({ checks, shown }: { checks: { label: string; ok: boolean }[]; shown: boolean }) {
  return (
    <ul
      className={`forum-in flex flex-wrap gap-2 ${shown ? "" : "forum-hidden"}`}
      aria-label="Checked by code"
      aria-hidden={!shown}
    >
      {checks.map((c) => (
        <li
          key={c.label}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs"
          style={{ background: c.ok ? "var(--tm-sage)" : "transparent", border: c.ok ? "1px solid var(--tm-border)" : "1px solid var(--tm-crimson)", color: c.ok ? "var(--tm-text)" : "var(--tm-crimson)" }} // prettier-ignore
        >
          {c.ok ? <Check size={14} weight="regular" /> : <X size={14} weight="regular" />}
          {c.label}
          <span className="sr-only">{c.ok ? "passed" : "failed"}</span>
        </li>
      ))}
    </ul>
  );
}
