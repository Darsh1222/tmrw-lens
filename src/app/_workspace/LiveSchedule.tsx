"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { DateTime } from "luxon";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, CalendarBlank, Check, Clock, Info, LockKey, Sparkle } from "@phosphor-icons/react";
import { scheduleEvents, scheduleSegments, type ScheduleSnapshot, type ScheduleSegment } from "@/lib/recovery/schedule";
import { calendarDeadlines, confirmDeadlineTime, emptyWeek, weekEvents, type SavedWeek } from "@/lib/recovery/week";
import { updateWeek } from "./week-store";

const PX = 64;
const subscribeNarrow = (fn: () => void) => {
  const query = window.matchMedia("(max-width: 800px)");
  query.addEventListener("change", fn);
  return () => query.removeEventListener("change", fn);
};
const narrowSnapshot = () => window.matchMedia("(max-width: 800px)").matches;
export function LiveSchedule({
  snapshot,
  week = emptyWeek(),
  onOpenTask,
  onPlanSource,
  onShowCurrentTask,
  expanded = false,
  onExpand,
}: {
  snapshot: ScheduleSnapshot | null;
  week?: SavedWeek;
  onOpenTask?: (id: string) => void;
  onPlanSource?: (id: string) => void;
  onShowCurrentTask?: () => void;
  expanded?: boolean;
  onExpand?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const deadlineRef = useRef<HTMLElement>(null),
    eventDetailsRef = useRef<HTMLDivElement>(null);
  const narrow = useSyncExternalStore(subscribeNarrow, narrowSnapshot, () => false);
  const [view, setView] = useState<"focus" | "week">("focus");
  const columns = view === "week" ? 7 : narrow ? 1 : 3;
  const [selectedDeadline, setSelectedDeadline] = useState<string | null>(null);
  const [reviewMissingTimes, setReviewMissingTimes] = useState(false);
  const [timeToConfirm, setTimeToConfirm] = useState("");
  const [editingDeadlineTime, setEditingDeadlineTime] = useState(false);
  const [detailError, setDetailError] = useState("");
  const reduced = useReducedMotion(),
    group = useId();
  const [page, setPage] = useState({ origin: "", offset: 0 }),
    [before, setBefore] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const [today] = useState(() => new Date().toISOString());
  const zone = snapshot?.request.zone ?? week.courses?.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const referenceNow = snapshot?.example ? snapshot.request.now : today;
  const anchor = DateTime.fromISO(referenceNow, { zone }).startOf("week");
  const firstWork = snapshot?.plan?.placements[0];
  const focusDate = DateTime.fromISO(!before && firstWork ? firstWork.start : referenceNow, {
    zone,
  });
  const focusDistance = Math.floor(focusDate.startOf("day").diff(anchor, "days").days);
  const focusDay = view === "week" ? Math.floor(focusDistance / 7) * 7 : focusDistance;
  const focusToken = `${view}:${columns}:${before}:${firstWork?.start ?? referenceNow}`;
  const offset = page.origin === focusToken ? page.offset : 0;
  const startDay = anchor.plus({ days: Math.max(-364, Math.min(364, focusDay + offset)) });
  const days = Array.from({ length: columns }, (_, n) => startDay.plus({ days: n }));
  const from = startDay.toISO()!,
    to = startDay.plus({ days: columns }).toISO()!;
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
  const deadlines = calendarDeadlines(snapshot, week);
  const issueFrom = DateTime.fromISO(referenceNow, { zone }).startOf("day");
  const missingTimes = deadlines
    .filter((d) => d.dateOnly)
    .sort((a, b) => {
      const aPast = Date.parse(a.due) < issueFrom.toMillis(),
        bPast = Date.parse(b.due) < issueFrom.toMillis();
      return aPast !== bPast
        ? Number(aPast) - Number(bPast)
        : aPast
          ? Date.parse(b.due) - Date.parse(a.due)
          : Date.parse(a.due) - Date.parse(b.due);
    });
  const deadlineDetails = deadlines.find((d) => d.id === selectedDeadline);
  const chooseDeadline = (id: string) => {
    setSelectedDeadline(id);
    setReviewMissingTimes(false);
    setSelected(null);
    setTimeToConfirm("");
    setEditingDeadlineTime(false);
    setDetailError("");
  };
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
      focus.toISODate()! <=
        DateTime.fromISO(firstDay!)
          .plus({ days: columns - 1 })
          .toISODate()!;
    const position = () => {
      if (!grid.clientWidth) return;
      const hour = shown ? focus.hour + focus.minute / 60 : 9;
      const col = shown ? Math.round(focus.startOf("day").diff(DateTime.fromISO(firstDay!, { zone }), "days").days) : 0;
      grid.scrollTo({
        top: Math.max(0, (hour - startHour) * PX - 64),
        left: Math.max(0, (col * (grid.scrollWidth - 48)) / columns),
        behavior: "instant",
      });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [focusToken, offset, startHour, firstWork, firstDay, zone, columns]);
  useEffect(() => {
    const panel = selectedDeadline ? deadlineRef.current : selected ? eventDetailsRef.current : null;
    if (!panel) return;
    panel.tabIndex = -1;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: "nearest", behavior: reduced ? "instant" : "smooth" });
  }, [selectedDeadline, selected, reduced]);
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
    <section
      className={`live-calendar ${expanded ? "is-expanded" : ""}`}
      aria-label="Your changing schedule"
      data-phase={snapshot?.phase ?? "empty"}
      style={
        {
          "--calendar-columns": columns,
          "--calendar-min-width": columns === 7 ? "1260px" : columns === 3 ? "680px" : "0px",
        } as React.CSSProperties
      }
    >
      <header className="calendar-toolbar">
        <div>
          <h2>Your schedule</h2>
        </div>
        <div className="calendar-toolbar-actions">
          {onExpand && (
            <button className="calendar-expand" onClick={onExpand}>
              {expanded ? "Return to split view" : "Expand calendar"}
            </button>
          )}
          <span className={`calendar-status ${snapshot?.phase === "preview" ? "is-preview" : ""}`} role="status">
            <span />
            {snapshot ? phase : week.courses || week.tasks.length ? "Saved on this device" : "Ready when you are"}
          </span>
        </div>
      </header>
      <div className="calendar-navigation">
        <div>
          <strong>
            {columns === 1
              ? startDay.toFormat("ccc, LLL d, yyyy")
              : `${startDay.toFormat("LLL d")} – ${days[columns - 1].toFormat("LLL d, yyyy")}`}
          </strong>
          <span>
            {snapshot?.example ? "Example schedule" : "Your saved week"} · {zone.replaceAll("_", " ")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="calendar-today"
            onClick={() =>
              setPage({
                origin: focusToken,
                offset: view === "week" ? -focusDay : Math.floor(issueFrom.diff(anchor, "days").days) - focusDay,
              })
            }
          >
            {view === "week" ? "This week" : "Today"}
          </button>
          <button
            className="calendar-arrow"
            aria-label={columns === 7 ? "Previous week" : columns === 1 ? "Previous day" : "Previous three days"}
            disabled={focusDay + offset <= -364}
            onClick={() => setPage({ origin: focusToken, offset: offset - columns })}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            className="calendar-arrow"
            aria-label={columns === 7 ? "Next week" : columns === 1 ? "Next day" : "Next three days"}
            disabled={focusDay + offset >= 364}
            onClick={() => setPage({ origin: focusToken, offset: offset + columns })}
          >
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
      <div className="calendar-view-choice" role="group" aria-label="Calendar density">
        <button aria-pressed={view === "focus"} onClick={() => setView("focus")}>
          {narrow ? "Day" : "3 days"}
        </button>
        <button aria-pressed={view === "week"} onClick={() => setView("week")}>
          Week
        </button>
        <span>Click a session or deadline for details.</span>
      </div>
      {missingTimes.length > 0 && (
        <section className="calendar-attention" aria-label="Deadlines missing a time">
          <p role="status">
            <Clock size={16} />
            <strong>
              {missingTimes.length} {missingTimes.length === 1 ? "deadline needs" : "deadlines need"} a time
            </strong>
          </p>
          <p>The source gives a date only. Confirm a time before relying on it.</p>
          <button
            className="calendar-review-times"
            aria-expanded={reviewMissingTimes}
            aria-controls={`${group}-missing-times`}
            onClick={() => setReviewMissingTimes((show) => !show)}
          >
            {reviewMissingTimes ? "Hide list" : deadlineDetails ? "Review another deadline" : "Review times"}
          </button>
          <ul id={`${group}-missing-times`} hidden={!reviewMissingTimes}>
            {missingTimes.map((d) => (
              <li key={d.id}>
                <button onClick={() => chooseDeadline(d.id)}>
                  <strong>{d.title}</strong>
                  <span>{DateTime.fromISO(d.due, { zone }).toFormat("LLL d")} · Time needed</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {deadlineDetails && (
        <section ref={deadlineRef} className="deadline-detail" aria-label="Deadline details">
          <p className="deadline-detail-kicker">Deadline details</p>
          <div className="deadline-detail-heading">
            <h3>{deadlineDetails.title}</h3>
            <button aria-label="Close deadline details" onClick={() => setSelectedDeadline(null)}>
              ×
            </button>
          </div>
          <p>
            {DateTime.fromISO(deadlineDetails.due, { zone }).toFormat("ccc, LLL d")}
            {deadlineDetails.dateOnly
              ? " · Time needed"
              : ` · ${DateTime.fromISO(deadlineDetails.due, { zone }).toFormat("h:mm a")}`}
          </p>
          <p>
            {deadlineDetails.timeOrigin === "source"
              ? "Time provided by the course material."
              : deadlineDetails.timeOrigin === "user"
                ? "Time chosen by you; the source may provide only the date."
                : "No clock time was provided. Lens has not assumed one."}
          </p>
          {deadlineDetails.evidence.map((e, n) => (
            <blockquote key={n}>
              <strong>
                {e.source}
                {e.page ? ` · page ${e.page}` : ""}
              </strong>
              <p>“{e.quote}”</p>
            </blockquote>
          ))}
          {deadlineDetails.taskId && onOpenTask && (
            <button className="deadline-action" onClick={() => onOpenTask(deadlineDetails.taskId!)}>
              Open linked task
            </button>
          )}
          {!deadlineDetails.taskId && deadlineDetails.currentTask && onShowCurrentTask && (
            <button className="deadline-action" onClick={onShowCurrentTask}>
              Open task
            </button>
          )}
          {!deadlineDetails.taskId && deadlineDetails.sourceId && onPlanSource && (
            <button className="deadline-action" onClick={() => onPlanSource(deadlineDetails.sourceId!)}>
              Plan this task
            </button>
          )}
          {!deadlineDetails.dateOnly && deadlineDetails.timeOrigin === "user" && deadlineDetails.sourceId && (
            <button
              className="deadline-action"
              onClick={() => {
                setTimeToConfirm(DateTime.fromISO(deadlineDetails.due, { zone }).toFormat("HH:mm"));
                setEditingDeadlineTime(true);
              }}
            >
              Change confirmed time
            </button>
          )}
          {(deadlineDetails.dateOnly || editingDeadlineTime) && deadlineDetails.sourceId && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  updateWeek((w) =>
                    confirmDeadlineTime(w, deadlineDetails.sourceId!, timeToConfirm, new Date().toISOString()),
                  );
                  setDetailError("");
                  setEditingDeadlineTime(false);
                } catch {
                  setDetailError("That time could not be saved. Choose a valid local time and check browser storage.");
                }
              }}
            >
              <p className="deadline-edit-note">
                This updates the reviewed deadline. Existing task plans stay unchanged; open a linked task to review its
                plan.
              </p>
              <label>
                Confirm deadline time
                <input required type="time" value={timeToConfirm} onChange={(e) => setTimeToConfirm(e.target.value)} />
              </label>
              <button type="submit">Save deadline time</button>
            </form>
          )}
          {detailError && <p role="alert">{detailError}</p>}
        </section>
      )}
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
      <AnimatePresence initial={false}>
        {details && (
          <motion.div
            ref={eventDetailsRef}
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
      <div ref={scroller} className="calendar-scroll" tabIndex={0} aria-label="Schedule grid, scroll to see all times">
        <div className="calendar-inner">
          <div className="calendar-day-headings">
            <div className="calendar-zone">
              <Clock size={15} />
            </div>
            {days.map((d) => (
              <div
                key={d.toISODate()}
                className={d.hasSame(issueFrom, "day") ? "calendar-day is-today" : "calendar-day"}
              >
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
                      <button
                        key={d.id}
                        onClick={() => chooseDeadline(d.id)}
                        aria-label={`${d.title}, time needed, open deadline details`}
                      >
                        <strong>{d.title}</strong>
                        <small>Time needed</small>
                      </button>
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
            {Array.from({ length: columns }, (_, n) => n).map((n) => (
              <div
                key={n}
                className="calendar-column"
                style={{ left: `calc(48px + (100% - 48px) * ${n} / ${columns})` }}
              />
            ))}
            <LayoutGroup id={group}>
              <AnimatePresence initial={false}>
                {segments.map((p) => {
                  const col = days.findIndex((d) => d.toISODate() === p.day);
                  const left = `calc(48px + (100% - 48px) * (${col} + ${p.lane} / ${p.lanes}) / ${columns} + 5px)`;
                  const width = `calc((100% - 48px) / ${columns} / ${p.lanes} - 10px)`;
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
                        height: Math.max(60, (p.to - p.from) * PX - 4),
                        borderRadius: 9,
                      }}
                      className={`calendar-event is-${p.kind} ${snapshot?.phase === "preview" && p.kind === "work" ? "is-proposed" : ""}`}
                      onClick={() => {
                        setSelected(p.key);
                        setSelectedDeadline(null);
                      }}
                      aria-label={eventTitle(p)}
                      aria-pressed={selected === p.key}
                    >
                      <motion.span layout="position" className="calendar-event-content">
                        <strong>{p.title}</strong>
                        {
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
                        }
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
                <button
                  key={d.id}
                  className="calendar-deadline"
                  onClick={() => chooseDeadline(d.id)}
                  aria-label={`${d.title}, due ${local.toFormat("ccc h:mm a")}, open deadline details`}
                  style={{
                    left: `calc(48px + (100% - 48px) * ${col} / ${columns} + 4px)`,
                    width: `calc((100% - 48px) / ${columns} - 8px)`,
                    top: (local.hour + local.minute / 60 - startHour) * PX,
                  }}
                >
                  <span>
                    {d.title} · {local.toFormat("h:mm a")}
                  </span>
                </button>
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
      <p className="calendar-size-note">
        Short sessions use extra space for readable titles. The times shown stay exact.
      </p>
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
          Keep office hours free for getting help{" "}
          <span>
            Office hours are optional time with an instructor or TA. When on, new study tasks avoid these sessions. This
            does not book an appointment or change existing tasks.
          </span>
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
