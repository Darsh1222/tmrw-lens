"use client";

import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { DateTime } from "luxon";
import { Fragment, useState } from "react";
import type { Plan } from "@/lib/plan/types";
import { Chip, Swatch } from "../ui";
import { entriesFor, firstWeek, rowsFor, semesterWeeks, weekDays, yOf, type Entry } from "./model";

// The plan in the same calendar language as the missed-session panel: a week
// grid (classes quiet, sessions and exams in their course's colour, date-only
// deadlines as flags), or the whole semester at a glance. Every item is a
// button that opens its evidence. On a phone the week is one day after another.

const AXIS = 56;

function Flag({ e, onOpen, arrive }: { e: Entry; onOpen: (id: string) => void; arrive: string | undefined }) {
  return (
    <button
      onClick={() => onOpen(e.id)}
      data-item={e.id}
      className={`flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-ink ${arrive ?? ""}`}
      style={{ background: `var(--tm-${e.tone})`, border: "1px solid var(--tm-border)" }}
      aria-label={`${e.title}, due, ${e.status === "verified" ? "verified" : "needs a look"}`}
    >
      <span aria-hidden className="h-3 w-0.5 shrink-0 rounded-full bg-crimson" />
      <span className="truncate">{e.title}</span>
    </button>
  );
}

export function WeekView({
  plan,
  today,
  onOpen,
  arrive,
}: {
  plan: Plan;
  today: string;
  onOpen: (id: string) => void;
  /** Class name for cards flying in after the outlines draw (empty once they've arrived). */
  arrive: (n: number) => string | undefined;
}) {
  const [monday, setMonday] = useState(() => firstWeek(plan, today));
  const days = weekDays(monday);
  const entries = entriesFor(plan, days);
  const rows = rowsFor(entries);
  const height = rows.reduce((a, r) => a + r.px, 0);
  const timed = entries.filter((e) => e.start !== null);
  const due = entries.filter((e) => e.start === null);
  const week = (n: number) => setMonday(DateTime.fromISO(monday).plus({ weeks: n }).toISODate()!);
  const label = `${DateTime.fromISO(days[0]).toFormat("LLL d")} – ${DateTime.fromISO(days[6]).toFormat("LLL d")}`;
  let n = 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="forum-display text-xl">Week of {label}</h3>
        <div className="flex gap-1">
          <button
            onClick={() => week(-1)}
            aria-label="Previous week"
            className="grid h-11 w-11 place-items-center rounded-lg border border-line-strong hover:bg-well"
          >
            <CaretLeft size={18} weight="light" />
          </button>
          <button
            onClick={() => week(1)}
            aria-label="Next week"
            className="grid h-11 w-11 place-items-center rounded-lg border border-line-strong hover:bg-well"
          >
            <CaretRight size={18} weight="light" />
          </button>
        </div>
      </div>

      {/* Wide: the grid. */}
      <div className="hidden md:block" role="group" aria-label={`Week of ${label}`}>
        <div className="grid" style={{ gridTemplateColumns: `${AXIS}px repeat(7, minmax(0, 1fr))` }}>
          <span />
          {days.map((d) => (
            <div key={d} className="px-1.5 pb-2 text-sm">
              <span className="font-medium">{DateTime.fromISO(d).toFormat("ccc")}</span>{" "}
              <span className="text-muted">{DateTime.fromISO(d).toFormat("d")}</span>
            </div>
          ))}
          <span className="pr-2 pt-1 text-right text-xs text-muted">Due</span>
          {days.map((d) => (
            <div key={d} className="flex min-h-10 flex-col gap-1 border-l border-line px-1 py-1">
              {due
                .filter((e) => e.day === d)
                .map((e) => (
                  <Flag key={e.key} e={e} onOpen={onOpen} arrive={arrive(n++)} />
                ))}
            </div>
          ))}
        </div>
        <div className="relative mt-1" style={{ height }}>
          {
            rows.reduce<{ top: number; el: React.ReactNode[] }>(
              (acc, r, k) => {
                acc.el.push(
                  <div key={k} className="absolute left-0 right-0" style={{ top: acc.top, height: r.px }}>
                    {r.label && (
                      <span className="absolute -top-2 left-0 w-12 text-right text-xs text-muted">{r.label}</span>
                    )}
                    <div
                      className="absolute right-0 top-0"
                      style={{ left: AXIS, borderTop: `1px ${r.label ? "solid" : "dashed"} var(--tm-border)` }}
                    />
                  </div>,
                );
                acc.top += r.px;
                return acc;
              },
              { top: 0, el: [] },
            ).el
          }
          {days.map((d, c) => (
            <div
              key={d}
              aria-hidden
              className="absolute bottom-0 top-0 border-l border-line"
              style={{ left: `calc(${AXIS}px + (100% - ${AXIS}px) * ${c} / 7)` }}
            />
          ))}
          {timed.map((e) => {
            const c = days.indexOf(e.day);
            const top = yOf(rows, e.start!);
            const h = Math.max(28, yOf(rows, e.end ?? e.start! + 0.5) - top);
            const cls = e.kind === "class";
            return (
              <button
                key={e.key}
                data-item={e.id}
                onClick={() => onOpen(e.id)}
                aria-label={`${e.title}, ${DateTime.fromISO(e.day).toFormat("cccc")} ${e.label}${cls ? ", class" : ""}`}
                className={`absolute overflow-hidden rounded-lg px-1.5 py-1 text-left text-xs ${cls ? "text-ink-2" : "text-ink"} ${arrive(n++) ?? ""}`}
                style={{
                  left: `calc(${AXIS}px + (100% - ${AXIS}px) * ${c} / 7 + 3px)`,
                  width: `calc((100% - ${AXIS}px) / 7 - 6px)`,
                  top,
                  height: h,
                  background: cls ? "var(--tm-sunken)" : `var(--tm-${e.tone})`,
                  border: "1px solid var(--tm-border)",
                }}
              >
                <span className="block truncate font-medium">{e.title}</span>
                <span className="block truncate text-ink-2">{cls ? "class" : e.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Narrow: one day after another. */}
      <ol className="flex flex-col gap-5 md:hidden" aria-label={`Week of ${label}`}>
        {days.map((d) => {
          const today_ = entries.filter((e) => e.day === d).sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
          return (
            <li key={d}>
              <h4 className="mb-2 text-sm">
                <span className="font-medium">{DateTime.fromISO(d).toFormat("cccc")}</span>{" "}
                <span className="text-muted">{DateTime.fromISO(d).toFormat("LLL d")}</span>
              </h4>
              {today_.length ? (
                <ul className="flex flex-col gap-2">
                  {today_.map((e) => (
                    <li key={e.key} className={arrive(n++)}>
                      <button
                        onClick={() => onOpen(e.id)}
                        data-item={e.id}
                        className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm"
                        style={{ background: e.kind === "class" ? "var(--tm-sunken)" : `var(--tm-${e.tone})`, border: "1px solid var(--tm-border)" }} // prettier-ignore
                      >
                        <span className="w-24 shrink-0 whitespace-nowrap text-xs text-ink-2">
                          {e.start === null ? "Due" : e.label}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
                        {e.kind === "item" && e.status !== "verified" && <Chip status={e.status} />}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Nothing planned.</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function SemesterView({ plan, onOpen }: { plan: Plan; onOpen: (id: string) => void }) {
  const weeks = semesterWeeks(plan);
  if (!weeks.length) return <p className="text-sm text-muted">Nothing dated yet. Answer a question or add a syllabus.</p>; // prettier-ignore
  const start = plan.term_start.date?.value ?? null;
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="The semester">
      <div className="hidden grid-cols-[96px_repeat(7,minmax(0,1fr))] gap-px text-xs text-muted md:grid">
        <span />
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="px-1.5 pb-1">
            {d}
          </span>
        ))}
      </div>
      <ol className="flex flex-col gap-px overflow-hidden rounded-xl border border-line bg-line">
        {weeks.map((monday) => {
          const days = weekDays(monday);
          const entries = entriesFor(plan, days).filter((e) => e.kind === "item");
          const term = start ? Math.floor(DateTime.fromISO(monday).diff(DateTime.fromISO(start).startOf("week"), "weeks").weeks) + 1 : null; // prettier-ignore
          return (
            <li key={monday} className="grid grid-cols-1 bg-paper md:grid-cols-[96px_repeat(7,minmax(0,1fr))]">
              <div className="flex items-baseline gap-2 px-3 py-2 text-xs md:flex-col md:gap-0">
                <span className="font-medium text-ink">{DateTime.fromISO(monday).toFormat("LLL d")}</span>
                {term !== null && term > 0 && <span className="text-muted">Week {term}</span>}
              </div>
              {days.map((d) => {
                const here = entries.filter((e) => e.day === d);
                return (
                  <Fragment key={d}>
                    <div
                      className={`flex-col gap-1 border-line p-1 md:flex md:min-h-12 md:border-l ${here.length ? "flex" : "hidden"}`}
                    >
                      {here.map((e) => (
                        <button
                          key={e.key}
                          onClick={() => onOpen(e.id)}
                          data-item={e.id}
                          className="flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-ink"
                          style={{ background: `var(--tm-${e.tone})` }}
                          aria-label={`${e.title}, ${DateTime.fromISO(d).toFormat("cccc LLL d")}${e.start !== null ? `, ${e.label}` : ""}`}
                        >
                          <span className="md:hidden text-ink-2">{DateTime.fromISO(d).toFormat("ccc")}</span>
                          <span className="truncate">{e.title}</span>
                          {e.status !== "verified" && (
                            <>
                              <Swatch tone="butter" className="ml-auto" />
                              <span className="sr-only">needs a look</span>
                            </>
                          )}
                        </button>
                      ))}
                    </div>
                  </Fragment>
                );
              })}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
