"use client";

import { Fragment } from "react";
import { clock, span, type Block, type WeekModel } from "./week";
import { blocksFor, type Phase } from "./WeekGrid";

// The week on a phone: one day after another, each a timeline of what's in
// it. The missed session turns into a dashed ghost in place; the moved one
// appears at its new time, fading and rising in (its reason is in "What changed"). Deadlines are thin flagged
// lines; Now is a line too.

type Entry = { at: number; key: string; node: React.ReactNode };

export function DayTimeline({ model, phase, missedId }: { model: WeekModel; phase: Phase; missedId: string }) {
  // Where a session will move to keeps its row from the start, invisible until it arrives, so the list never jumps.
  const blocks =
    phase === "before" || phase === "missed"
      ? [...blocksFor(model, phase, missedId), ...model.after.filter((b) => b.moved)]
      : blocksFor(model, phase, missedId);
  const arrived = phase === "after";
  const row = (b: Block): Entry => {
    const moved = !!b.moved;
    return {
      at: b.start,
      key: b.key,
      node: (
        <li
          data-item={b.id ?? undefined}
          data-kind={b.kind}
          data-start={new Date(b.start).toISOString()}
          aria-hidden={moved && !arrived}
          className={`forum-in flex gap-3 ${moved && !arrived ? "forum-hidden" : ""}`}
        >
          <span className="w-[7.5rem] shrink-0 whitespace-nowrap pt-2 text-xs" style={{ color: "var(--tm-muted)" }}>
            {span(b.start, b.end, model.zone)}
          </span>
          <div
            className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm"
            style={{
              background: b.kind === "class" ? "var(--tm-sunken)" : b.kind === "ghost" ? "transparent" : `var(--tm-${b.color ?? "powder"})`, // prettier-ignore
              border: b.kind === "ghost" ? "1px dashed var(--tm-border-strong)" : "1px solid var(--tm-border)",
              opacity: b.kind === "ghost" ? 0.7 : 1,
              color: b.kind === "class" ? "var(--tm-text-2)" : "var(--tm-text)",
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium">{b.title}</span>
              <span className="shrink-0 text-xs" style={{ color: "var(--tm-text-2)" }}>
                {b.kind === "class" ? "class" : b.ghost ? b.ghost : moved ? "moved" : ""}
              </span>
            </div>
          </div>
        </li>
      ),
    };
  };
  return (
    <div className="flex flex-col gap-6" role="group" aria-label="The week">
      {model.days.map((d) => {
        const entries: Entry[] = [
          ...blocks.filter((b) => b.day === d.iso).map(row),
          ...model.markers
            .filter((m) => m.day === d.iso)
            .map((m) => {
              const now = m.kind === "now";
              const color = now ? "var(--tm-text)" : "var(--tm-crimson)";
              return {
                at: m.at,
                key: m.key,
                node: (
                  <li data-marker={m.kind} className="flex items-center gap-3 text-xs" style={{ color }}>
                    <span className="w-[7.5rem] shrink-0 whitespace-nowrap">{clock(m.at, model.zone)}</span>
                    <span className="h-px flex-1" style={{ background: color }} />
                    <span>{now ? "Now" : m.title}</span>
                  </li>
                ),
              };
            }),
        ].sort((a, b) => a.at - b.at);
        return (
          <section key={d.iso} aria-label={`${d.weekday} ${d.date}`}>
            <h3 className="mb-2 text-sm">
              <span className="font-medium">{d.weekday}</span>{" "}
              <span style={{ color: "var(--tm-muted)" }}>{d.date}</span>
            </h3>
            <ol className="flex flex-col gap-2">
              {entries.map((e) => (
                <Fragment key={e.key}>{e.node}</Fragment>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
