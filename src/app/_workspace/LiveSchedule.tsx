"use client";
import { useId, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, CalendarBlank, Check, Clock, Info, LockKey, Sparkle } from "@phosphor-icons/react";
import {
  scheduleDeadlines,
  scheduleEvents,
  scheduleSegments,
  type ScheduleSnapshot,
  type ScheduleSegment,
} from "@/lib/recovery/schedule";

const PX = 32;
export function LiveSchedule({ snapshot }: { snapshot: ScheduleSnapshot | null }) {
  const reduced = useReducedMotion(),
    group = useId();
  const [page, setPage] = useState({ origin: "", offset: 0 }),
    [before, setBefore] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const [today] = useState(() => new Date().toISOString());
  const zone = snapshot?.request.zone ?? "America/New_York";
  const anchor = DateTime.fromISO(snapshot?.request.now ?? today, { zone }).startOf("day");
  const firstWork = snapshot?.plan?.placements[0];
  const focusDay =
    !before && firstWork
      ? Math.floor(DateTime.fromISO(firstWork.start, { zone }).startOf("day").diff(anchor, "days").days / 3) * 3
      : 0;
  const focusToken = `${before}:${firstWork?.start ?? snapshot?.request.now ?? "empty"}`;
  const offset = page.origin === focusToken ? page.offset : 0;
  const startDay = anchor.plus({ days: Math.max(0, Math.min(12, focusDay + offset)) });
  const days = [0, 1, 2].map((n) => startDay.plus({ days: n }));
  const events = useMemo(() => (snapshot ? scheduleEvents(snapshot, before) : []), [snapshot, before]);
  const segments = scheduleSegments(
    events,
    zone,
    days.map((d) => d.toISODate()!),
  );
  const deadlines = snapshot ? scheduleDeadlines(snapshot) : [];
  const visibleDeadlines = deadlines
    .map((d) => DateTime.fromISO(d.due, { zone }))
    .filter((d) => days.some((day) => day.hasSame(d, "day")));
  const startHour = Math.max(
    0,
    Math.min(7, ...segments.map((p) => Math.floor(p.from)), ...visibleDeadlines.map((d) => d.hour)),
  );
  const endHour = Math.min(
    24,
    Math.max(22, ...segments.map((p) => Math.ceil(p.to)), ...visibleDeadlines.map((d) => d.hour + 1)),
  );
  const hours = Array.from({ length: endHour - startHour }, (_, n) => startHour + n);
  const height = (endHour - startHour) * PX;
  const details = segments.find((p) => p.key === selected);
  const phase = before
    ? "Original plan"
    : snapshot?.phase === "preview"
      ? "Preview · not applied"
      : snapshot?.phase === "active"
        ? "Plan updated"
        : snapshot?.phase === "done"
          ? "Work finished"
          : "Before recovery";
  const duration = reduced ? 0 : 0.62;
  const eventTitle = (p: ScheduleSegment) =>
    `${p.title}, ${DateTime.fromISO(p.start, { zone }).toFormat("ccc h:mm a")}–${DateTime.fromISO(p.end, { zone }).toFormat("h:mm a")}${snapshot?.phase === "preview" && p.kind === "work" ? ", proposed" : ""}`;
  return (
    <section className="live-calendar" aria-label="Your changing schedule" data-phase={snapshot?.phase ?? "empty"}>
      <header className="calendar-toolbar">
        <div>
          <h2>Your schedule</h2>
        </div>
        <span className={`calendar-status ${snapshot?.phase === "preview" ? "is-preview" : ""}`} role="status">
          <span />
          {snapshot ? phase : "Ready when you are"}
        </span>
      </header>
      <div className="calendar-navigation">
        <div>
          <strong>{startDay.toFormat("LLLL yyyy")}</strong>
          <span>
            {snapshot?.example ? "Example schedule" : "Your availability"} · {zone.replaceAll("_", " ")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="calendar-arrow"
            aria-label="Previous three days"
            disabled={focusDay + offset <= 0}
            onClick={() => setPage({ origin: focusToken, offset: offset - 3 })}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            className="calendar-arrow"
            aria-label="Next three days"
            disabled={focusDay + offset >= 12}
            onClick={() => setPage({ origin: focusToken, offset: offset + 3 })}
          >
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
      {snapshot?.example && (
        <div className="calendar-compare" role="group" aria-label="Compare schedule">
          <button aria-pressed={before} onClick={() => setBefore(true)}>
            Original week
          </button>
          <button aria-pressed={!before} onClick={() => setBefore(false)}>
            {snapshot.plan ? "New plan" : "Working week"}
          </button>
        </div>
      )}
      <div className="calendar-scroll" tabIndex={0} aria-label="Schedule grid, scroll to see all times">
        <div className="calendar-inner">
          <div className="calendar-day-headings">
            <div className="calendar-zone">
              <Clock size={15} />
            </div>
            {days.map((d) => (
              <div key={d.toISODate()} className={d.hasSame(anchor, "day") ? "calendar-day is-today" : "calendar-day"}>
                <span>{d.toFormat("ccc")}</span>
                <strong>{d.toFormat("d")}</strong>
              </div>
            ))}
          </div>
          <div className="calendar-time-body" style={{ height }}>
            {hours.map((hour) => (
              <div key={hour} className="calendar-hour" style={{ top: (hour - startHour) * PX }}>
                <span>{DateTime.fromObject({ hour }).toFormat("ha").toLowerCase()}</span>
                <i />
              </div>
            ))}
            {[0, 1, 2].map((n) => (
              <div key={n} className="calendar-column" style={{ left: `calc(48px + (100% - 48px) * ${n} / 3)` }} />
            ))}
            <LayoutGroup id={group}>
              <AnimatePresence initial={false}>
                {segments.map((p) => {
                  const col = days.findIndex((d) => d.toISODate() === p.day);
                  const left = `calc(48px + (100% - 48px) * (${col} + ${p.lane} / ${p.lanes}) / 3 + 5px)`;
                  const width = `calc((100% - 48px) / 3 / ${p.lanes} - 10px)`;
                  return (
                    <motion.button
                      key={p.key}
                      layout
                      layoutId={p.key}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: p.kind === "ghost" ? 0.48 : 1 }}
                      exit={{ opacity: 0, transition: { duration: 0.16 } }}
                      transition={{
                        layout: { duration, ease: [0.22, 1, 0.36, 1] },
                        opacity: { duration: reduced ? 0 : 0.2 },
                      }}
                      style={{
                        left,
                        width,
                        top: (p.from - startHour) * PX + 2,
                        height: Math.max(27, (p.to - p.from) * PX - 4),
                        borderRadius: 9,
                      }}
                      className={`calendar-event is-${p.kind} ${snapshot?.phase === "preview" && p.kind === "work" ? "is-proposed" : ""}`}
                      onClick={() => setSelected(p.key)}
                      aria-label={eventTitle(p)}
                      aria-pressed={selected === p.key}
                    >
                      <motion.span layout="position" className="calendar-event-content">
                        <strong>{p.to - p.from < 0.5 ? `${p.minutes} min start` : p.title}</strong>
                        {p.to - p.from >= 0.85 && (
                          <small>
                            {DateTime.fromISO(p.start, { zone }).toFormat("h:mm")} ·{" "}
                            {p.kind === "fixed" ? "Protected" : `${p.minutes} min`}
                          </small>
                        )}
                      </motion.span>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </LayoutGroup>
            {deadlines.map((d) => {
              const local = DateTime.fromISO(d.due, { zone }),
                col = days.findIndex((day) => day.toISODate() === local.toISODate());
              if (col < 0 || local.hour < startHour || local.hour >= endHour) return null;
              return (
                <div
                  key={d.id}
                  className="calendar-deadline"
                  style={{
                    left: `calc(48px + (100% - 48px) * ${col} / 3 + 4px)`,
                    width: "calc((100% - 48px) / 3 - 8px)",
                    top: (local.hour + local.minute / 60 - startHour) * PX,
                  }}
                >
                  <span>
                    {d.title} · {local.toFormat("h:mm a")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {!snapshot && (
          <div className="calendar-empty">
            <CalendarBlank size={32} weight="light" />
            <p>Your week starts with one task.</p>
            <span>Add its deadline and the time you have. A checked plan will appear here.</span>
          </div>
        )}
      </div>
      <AnimatePresence initial={false}>
        {details && (
          <motion.div
            className="calendar-event-detail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div>
              <Info size={17} />
              <p>
                <strong>{details.title}</strong>
                <span>
                  {DateTime.fromISO(details.start, { zone }).toFormat("ccc, LLL d · h:mm a")}–
                  {DateTime.fromISO(details.end, { zone }).toFormat("h:mm a")} · {details.minutes} minutes
                </span>
              </p>
              <button aria-label="Close event details" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <footer className="calendar-footer">
        <div>
          <span className="legend-dot is-work" />
          Study time
          <span className="legend-dot is-fixed" />
          Protected
          <span className="legend-due" />
          Deadline
        </div>
        <p>
          {snapshot?.plan ? (
            <>
              <Check size={15} />
              All {snapshot.plan.required} remaining minutes planned
            </>
          ) : (
            <>
              <LockKey size={15} />
              Classes and sleep stay protected
            </>
          )}
        </p>
      </footer>
      <div className="calendar-change-note" aria-live="polite">
        <Sparkle size={17} weight="light" />
        <span>
          {snapshot?.phase === "preview"
            ? "Watch the proposed change. Your week changes only after you approve."
            : snapshot?.phase === "active"
              ? `${snapshot.completedMinutes ? `${snapshot.completedMinutes} minutes reported finished. ` : ""}Your next step has a place. Change it whenever you need.`
              : snapshot?.phase === "done"
                ? "Finished from your report. Your other commitments remain in place."
                : "Choose what got in the way to see a complete recovery plan."}
        </span>
      </div>
    </section>
  );
}
