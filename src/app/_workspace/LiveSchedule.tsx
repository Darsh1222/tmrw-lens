"use client";
import { useEffect, useId, useRef, useState } from "react";
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
import { emptyWeek, savedDeadlines, weekEvents, type SavedWeek } from "@/lib/recovery/week";
import { updateWeek } from "./week-store";

const PX = 44;
const COLUMNS = 7;
export function LiveSchedule({
  snapshot,
  week = emptyWeek(),
  onOpenTask,
}: {
  snapshot: ScheduleSnapshot | null;
  week?: SavedWeek;
  onOpenTask?: (id: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion(),
    group = useId();
  const [page, setPage] = useState({ origin: "", offset: 0 }),
    [before, setBefore] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const [today] = useState(() => new Date().toISOString());
  const zone = snapshot?.request.zone ?? week.courses?.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const anchor = DateTime.fromISO(snapshot?.request.now ?? today, { zone }).startOf("week");
  const firstWork = snapshot?.plan?.placements[0];
  const focusDay =
    !before && firstWork
      ? Math.floor(DateTime.fromISO(firstWork.start, { zone }).startOf("day").diff(anchor, "days").days / 7) * 7
      : 0;
  const focusToken = `${before}:${firstWork?.start ?? snapshot?.request.now ?? "empty"}`;
  const offset = page.origin === focusToken ? page.offset : 0;
  const startDay = anchor.plus({ days: Math.max(-364, Math.min(364, focusDay + offset)) });
  const days = [0, 1, 2, 3, 4, 5, 6].map((n) => startDay.plus({ days: n }));
  const from = startDay.toISO()!,
    to = startDay.plus({ days: 7 }).toISO()!;
  const events = (() => {
    const saved = snapshot?.example ? [] : weekEvents(week, from, to, snapshot?.taskId);
    const working = snapshot ? scheduleEvents(snapshot, before) : [];
    const seen = new Set<string>();
    return [...saved, ...working].filter((p) => {
      const key = `${p.title}:${Date.parse(p.start)}:${Date.parse(p.end)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();
  const segments = scheduleSegments(
    events,
    zone,
    days.map((d) => d.toISODate()!),
  );
  const deadlines = [
    ...(snapshot ? scheduleDeadlines(snapshot) : []),
    ...(!snapshot?.example ? savedDeadlines(week) : []),
  ].filter(
    (d, n, all) =>
      all.findIndex(
        (x) => x.title.replace(/ due$/, "") === d.title.replace(/ due$/, "") && Date.parse(x.due) === Date.parse(d.due),
      ) === n,
  );
  const visibleDeadlines = deadlines
    .filter((d) => !("dateOnly" in d && d.dateOnly))
    .map((d) => DateTime.fromISO(d.due, { zone }))
    .filter((d) => days.some((day) => day.hasSame(d, "day")));
  const startHour = Math.max(
    0,
    Math.min(8, ...segments.map((p) => Math.floor(p.from)), ...visibleDeadlines.map((d) => d.hour)),
  );
  const endHour = Math.min(
    24,
    Math.max(22, ...segments.map((p) => Math.ceil(p.to)), ...visibleDeadlines.map((d) => d.hour + 1)),
  );
  const hours = Array.from({ length: endHour - startHour }, (_, n) => startHour + n);
  const height = (endHour - startHour) * PX;
  const details = segments.find((p) => p.key === selected);
  const firstDay = startDay.toISODate();
  useEffect(() => {
    const grid = scroller.current;
    if (!grid) return;
    const focus = firstWork && DateTime.fromISO(firstWork.start, { zone });
    const shown =
      focus &&
      focus.toISODate()! >= firstDay! &&
      focus.toISODate()! <= DateTime.fromISO(firstDay!).plus({ days: 6 }).toISODate()!;
    const position = () => {
      if (!grid.clientWidth) return;
      const hour = shown ? focus.hour + focus.minute / 60 : 9;
      const col = shown ? Math.round(focus.startOf("day").diff(DateTime.fromISO(firstDay!, { zone }), "days").days) : 0;
      grid.scrollTo({
        top: Math.max(0, (hour - startHour) * PX - 64),
        left: Math.max(0, (col * (grid.scrollWidth - 48)) / 7),
        behavior: "instant",
      });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [focusToken, offset, startHour, firstWork, firstDay, zone]);
  const phase = before
    ? "Original schedule"
    : snapshot?.phase === "preview"
      ? "Preview · approve to use"
      : snapshot?.phase === "active"
        ? "Plan updated"
        : snapshot?.phase === "done"
          ? "Task complete"
          : "Current schedule";
  const duration = reduced ? 0 : 0.38;
  const eventTitle = (p: ScheduleSegment) =>
    `${p.title}, ${DateTime.fromISO(p.start, { zone }).toFormat("ccc h:mm a")}–${DateTime.fromISO(p.end, { zone }).toFormat(DateTime.fromISO(p.start, { zone }).hasSame(DateTime.fromISO(p.end, { zone }), "day") ? "h:mm a" : "ccc, LLL d h:mm a")}${snapshot?.phase === "preview" && p.kind === "work" ? ", proposed" : ""}`;
  return (
    <section className="live-calendar" aria-label="Your changing schedule" data-phase={snapshot?.phase ?? "empty"}>
      <header className="calendar-toolbar">
        <div>
          <h2>Your schedule</h2>
        </div>
        <span className={`calendar-status ${snapshot?.phase === "preview" ? "is-preview" : ""}`} role="status">
          <span />
          {snapshot ? phase : week.courses || week.tasks.length ? "Saved on this device" : "Ready when you are"}
        </span>
      </header>
      <div className="calendar-navigation">
        <div>
          <strong>
            {startDay.toFormat("LLL d")} – {days[6].toFormat("LLL d, yyyy")}
          </strong>
          <span>
            {snapshot?.example ? "Example schedule" : "Your saved week"} · {zone.replaceAll("_", " ")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button className="calendar-today" onClick={() => setPage({ origin: focusToken, offset: -focusDay })}>
            This week
          </button>
          <button
            className="calendar-arrow"
            aria-label="Previous week"
            disabled={focusDay + offset <= -364}
            onClick={() => setPage({ origin: focusToken, offset: offset - 7 })}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            className="calendar-arrow"
            aria-label="Next week"
            disabled={focusDay + offset >= 364}
            onClick={() => setPage({ origin: focusToken, offset: offset + 7 })}
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
      <div ref={scroller} className="calendar-scroll" tabIndex={0} aria-label="Schedule grid, scroll to see all times">
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
          {deadlines.some((d) => "dateOnly" in d && d.dateOnly) && (
            <div className="calendar-due-strip">
              <span>Due</span>
              {days.map((day) => (
                <div key={day.toISODate()}>
                  {deadlines
                    .filter(
                      (d) => "dateOnly" in d && d.dateOnly && DateTime.fromISO(d.due, { zone }).hasSame(day, "day"),
                    )
                    .map((d) => (
                      <span key={d.id} title={`${d.title}: source gives a date, no time`}>
                        {d.title}
                        <small>No time provided</small>
                      </span>
                    ))}
                </div>
              ))}
            </div>
          )}
          <div className="calendar-time-body" style={{ height }}>
            {hours.map((hour) => (
              <div key={hour} className="calendar-hour" style={{ top: (hour - startHour) * PX }}>
                <span>{DateTime.fromObject({ hour }).toFormat("ha").toLowerCase()}</span>
                <i />
              </div>
            ))}
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <div
                key={n}
                className="calendar-column"
                style={{ left: `calc(48px + (100% - 48px) * ${n} / ${COLUMNS})` }}
              />
            ))}
            <LayoutGroup id={group}>
              <AnimatePresence initial={false}>
                {segments.map((p) => {
                  const col = days.findIndex((d) => d.toISODate() === p.day);
                  const left = `calc(48px + (100% - 48px) * (${col} + ${p.lane} / ${p.lanes}) / ${COLUMNS} + 5px)`;
                  const width = `calc((100% - 48px) / ${COLUMNS} / ${p.lanes} - 10px)`;
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
                        <strong>{p.to - p.from < 0.5 || p.lanes > 1 ? `${p.minutes}m` : p.title}</strong>
                        {p.to - p.from >= 0.85 && (
                          <small>
                            {DateTime.fromISO(p.start, { zone }).toFormat("h:mm")} ·{" "}
                            {p.kind === "office"
                              ? "Optional help"
                              : p.kind === "completed"
                                ? "Finished"
                                : p.kind === "fixed"
                                  ? "Class / busy"
                                  : `${p.minutes} min`}
                          </small>
                        )}
                      </motion.span>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </LayoutGroup>
            {deadlines.map((d) => {
              if ("dateOnly" in d && d.dateOnly) return null;
              const local = DateTime.fromISO(d.due, { zone }),
                col = days.findIndex((day) => day.toISODate() === local.toISODate());
              if (col < 0 || local.hour < startHour || local.hour >= endHour) return null;
              return (
                <div
                  key={d.id}
                  className="calendar-deadline"
                  style={{
                    left: `calc(48px + (100% - 48px) * ${col} / ${COLUMNS} + 4px)`,
                    width: `calc((100% - 48px) / ${COLUMNS} - 8px)`,
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
        {!snapshot && !events.length && !deadlines.length && (
          <div className="calendar-empty">
            <CalendarBlank size={32} weight="light" />
            <p>Your schedule belongs here.</p>
            <span>Save your reviewed class schedule, then add a task. Lens finds study time around it.</span>
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
                <span>
                  {details.kind === "office"
                    ? week.attendOfficeHours
                      ? "Office hours are optional help sessions. You chose to reserve this time."
                      : "Optional help from your instructor or TA. This time stays available for studying unless you reserve it below."
                    : details.kind === "fixed"
                      ? "A saved class or fixed commitment. Study tasks are planned around this time."
                      : details.kind === "completed"
                        ? "Finished from your report. Kept here as a record of your planned study session."
                        : "Study time saved for this task."}
                </span>
              </p>
              {details.taskId && (
                <button className="calendar-open-task" onClick={() => onOpenTask?.(details.taskId!)}>
                  Open task
                </button>
              )}
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
          <span className="legend-dot is-office" />
          Optional help
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
      {!snapshot?.example && week.courses?.items.some((i) => /office\s*hours?/i.test(i.title)) && (
        <label className="office-hours-preference">
          <input
            type="checkbox"
            checked={week.attendOfficeHours}
            onChange={(e) => updateWeek((w) => ({ ...w, attendOfficeHours: e.target.checked }))}
          />{" "}
          Reserve office hours when planning new tasks{" "}
          <span>Optional help sessions, separate from regular classes.</span>
        </label>
      )}
      <div className="calendar-change-note" aria-live="polite">
        <Sparkle size={17} weight="light" />
        <span>
          {snapshot?.phase === "preview"
            ? "Watch the proposed change. Your week changes only after you approve."
            : snapshot?.phase === "active"
              ? `${snapshot.completedMinutes ? `${snapshot.completedMinutes} minutes reported finished. ` : ""}Your next step has a place. Change it whenever you need.`
              : snapshot?.phase === "done"
                ? "Finished from your report. Your other commitments remain in place."
                : week.tasks.length
                  ? "Your saved tasks stay on their dates as you browse weeks. Add another task to find its next available slot."
                  : "Start with your course schedule. New tasks will fit around the commitments you save."}
        </span>
      </div>
    </section>
  );
}
