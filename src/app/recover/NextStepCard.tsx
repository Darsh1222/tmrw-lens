"use client";
import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { preferredProposal } from "@/lib/recovery/presentation";
import {
  NEXT_STEP_KEY,
  applyTaskChange,
  finishNextStep,
  nextStepKey,
  previewTaskChange,
  readNextTask,
  sourceMatchesDeadline,
  taskDeadline,
  type NextTask,
} from "@/lib/recovery/next-step";
import type { Obstacle } from "@/lib/recovery/engine";
import { recoveryCalendar } from "@/lib/recovery/workspace";
import { buttonClass } from "../_lens/styles";

export function returningTask(): NextTask | null {
  try {
    const candidates = [
      readNextTask(sessionStorage.getItem(NEXT_STEP_KEY)),
      readNextTask(localStorage.getItem(NEXT_STEP_KEY)),
    ].filter((t): t is NextTask => !!t && !t.example);
    return candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
  } catch {
    return null;
  }
}
export function keepTask(task: NextTask, remember: boolean) {
  if (task.example) return;
  sessionStorage.setItem(NEXT_STEP_KEY, JSON.stringify(task));
  if (remember) localStorage.setItem(NEXT_STEP_KEY, JSON.stringify(task));
  else localStorage.removeItem(NEXT_STEP_KEY);
}
export function clearTask() {
  sessionStorage.removeItem(NEXT_STEP_KEY);
  localStorage.removeItem(NEXT_STEP_KEY);
}
const field = "min-h-12 w-full rounded-xl border border-line-input bg-paper px-4 py-3 text-base";
type Preview = ReturnType<typeof previewTaskChange>;
export function NextStepCard({
  task,
  onChange,
  onNewTask,
  onUndoPlan,
  onRecord,
  logged,
}: {
  task: NextTask;
  onChange: (task: NextTask) => void;
  onNewTask: () => void;
  onUndoPlan: () => void;
  onRecord: (task: NextTask, actual: number) => void;
  logged: boolean;
}) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setClock(Date.now());
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const [previous, setPrevious] = useState<NextTask | null>(null);
  const [changing, setChanging] = useState(false),
    [left, setLeft] = useState(task.remainingMinutes);
  const [obstacle, setObstacle] = useState<Obstacle>("interrupted");
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState("");
  const [freeAgain, setFreeAgain] = useState(() =>
    DateTime.fromISO(task.example ? task.updatedAt : new Date().toISOString(), { zone: task.input.request.zone })
      .plus({ hours: 1 })
      .toFormat("yyyy-MM-dd'T'HH:mm"),
  );
  const [actual, setActual] = useState(""),
    [message, setMessage] = useState("");
  const [remember, setRemember] = useState(() => {
    try {
      return !task.example && !!localStorage.getItem(NEXT_STEP_KEY);
    } catch {
      return false;
    }
  });
  const step = task.plan.placements[0],
    item = task.input.request.items.find((i) => i.id === task.input.request.missed.item_id)!;
  const date = (s: string) => DateTime.fromISO(s, { zone: task.input.request.zone }).toFormat("ccc, LLL d · h:mm a");
  const stale = !!step && !task.example && Date.parse(step.end) < clock;
  const deadline = taskDeadline(task);
  const picked = preview && preferredProposal(preview.result, obstacle);
  const commit = (next: NextTask) => {
    setPrevious(task);
    onChange(next);
    setLeft(next.remainingMinutes);
    setError("");
    try {
      keepTask(next, remember);
    } catch {
      setError("Your change works here, but this browser could not save it. Keep this tab open.");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([recoveryCalendar(task.input.request, task.plan, new Date())], { type: "text/calendar" }),
    );
    Object.assign(document.createElement("a"), { href: url, download: "lens-next-step.ics" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="rounded-2xl border border-line bg-card p-6 sm:p-8" aria-labelledby="next-heading">
      <p className="text-sm text-ink-2">
        {task.example
          ? "Example task · no personal history is saved"
          : task.status === "done"
            ? "Finished, from your report"
            : "Your next step"}
      </p>
      <h2 id="next-heading" className="forum-display mt-3 text-3xl sm:text-4xl">
        {task.status === "done" ? "That task is finished." : item.title}
      </h2>
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-crimson p-4 text-crimson">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-4 text-sm">
          {message}
        </p>
      )}
      {task.status === "active" && step && (
        <>
          <div className="my-6 rounded-xl border border-line bg-well p-5">
            <p className="text-2xl font-medium">
              {step.minutes} minutes{step.starter ? " to get started" : " for this step"}
            </p>
            <p className="mt-2 text-ink-2">{date(step.start)}</p>
            <p className="mt-3 text-sm">
              {task.completedMinutes > 0 ? `${task.completedMinutes} minutes of planned work finished · ` : ""}
              {task.remainingMinutes} minutes left in the whole task
            </p>
          </div>
          {stale && (
            <p className="mb-4 text-sm text-crimson">
              This planned time has passed. Tell us what happened; nothing was marked finished.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className={buttonClass("primary", "min-h-12 text-base")}
              onClick={() => {
                const key = nextStepKey(task);
                if (!key) return;
                commit(
                  finishNextStep(
                    task,
                    key,
                    task.example
                      ? new Date(Math.max(Date.parse(task.updatedAt), Date.parse(step.end))).toISOString()
                      : new Date().toISOString(),
                  ),
                );
                setMessage(
                  task.plan.placements.length > 1
                    ? "Step finished. The rest of your work stays in the plan."
                    : "Marked finished from your report.",
                );
              }}
            >
              Finished this step
            </button>
            <button
              className={buttonClass("quiet", "min-h-12 text-base")}
              onClick={() => {
                setChanging(!changing);
                setPreview(null);
                setLeft(task.remainingMinutes);
                setFreeAgain(
                  DateTime.fromISO(task.example ? task.updatedAt : new Date().toISOString(), {
                    zone: task.input.request.zone,
                  })
                    .plus({ hours: 1 })
                    .toFormat("yyyy-MM-dd'T'HH:mm"),
                );
                setError("");
              }}
            >
              Plans changed
            </button>
          </div>
          {changing && (
            <form
              className="mt-6 flex flex-col gap-4 border-t border-line pt-5"
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                try {
                  const free =
                    obstacle === "interrupted" ? DateTime.fromISO(freeAgain, { zone: task.input.request.zone }) : null;
                  if (
                    free &&
                    (!free.isValid ||
                      free.getPossibleOffsets().length !== 1 ||
                      free.toFormat("yyyy-MM-dd'T'HH:mm") !== freeAgain)
                  )
                    throw new Error("Choose an unambiguous local time.");
                  setPreview(
                    previewTaskChange(
                      task,
                      left,
                      obstacle,
                      task.example ? task.updatedAt : new Date().toISOString(),
                      free?.toISO() ?? undefined,
                    ),
                  );
                } catch {
                  setError(
                    "Enter the work still needed in multiples of 5 minutes, from 5 to 600. Check when you are free again and your device time too.",
                  );
                }
              }}
            >
              <label className="text-sm">
                How many minutes of work are still needed?
                <input
                  className={`${field} mt-2`}
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  required
                  value={left}
                  onChange={(e) => {
                    setLeft(Number(e.target.value));
                    setPreview(null);
                  }}
                />
              </label>
              <p className="text-sm text-ink-2">
                Estimate the unfinished work, rather than time already spent. Finished steps stay finished.
              </p>
              <label className="text-sm">
                What would help?
                <select
                  className={`${field} mt-2`}
                  value={obstacle}
                  onChange={(e) => {
                    setObstacle(e.target.value as Obstacle);
                    setPreview(null);
                  }}
                >
                  <option value="interrupted">Another time</option>
                  <option value="stuck">A smaller first step</option>
                  <option value="tired">Keep the rest of today free</option>
                  <option value="underestimated">More time for the work</option>
                </select>
              </label>
              {obstacle === "interrupted" && (
                <label className="text-sm">
                  When will you be free again?
                  <input
                    type="datetime-local"
                    required
                    className={`${field} mt-2`}
                    value={freeAgain}
                    onChange={(e) => {
                      setFreeAgain(e.target.value);
                      setPreview(null);
                    }}
                  />
                  <span className="mt-2 block text-xs text-ink-2">
                    Times in {task.input.request.zone}. This time stays unavailable.
                  </span>
                </label>
              )}
              <button className={buttonClass("quiet", "min-h-12")}>Find a new plan</button>
              {preview &&
                (picked ? (
                  <div role="status" className="rounded-xl bg-well p-4">
                    <p className="font-medium">
                      {picked.placements[0].minutes} minutes · {date(picked.placements[0].start)}
                    </p>
                    <p className="mt-2 text-sm">
                      All {picked.required} remaining minutes are planned. Your {task.completedMinutes} finished minutes
                      stay finished. No other tasks move.
                    </p>
                    <button
                      type="button"
                      className={buttonClass("primary", "mt-4 min-h-12 w-full")}
                      onClick={() => {
                        try {
                          commit(
                            applyTaskChange(
                              task,
                              preview.input,
                              picked,
                              task.example ? task.updatedAt : new Date().toISOString(),
                            ),
                          );
                          setChanging(false);
                          setPreview(null);
                          setMessage(
                            "New plan applied. Your deadline, fixed commitments, and reported progress are preserved.",
                          );
                        } catch {
                          setError("This preview needs another check. Find a new plan again.");
                        }
                      }}
                    >
                      Use this new plan
                    </button>
                  </div>
                ) : (
                  <p role="status" className="text-sm">
                    No complete plan was found for all {preview.result.estimate.minutes} minutes under your current
                    times and deadline. Your current task is unchanged. Review availability or ask for a scope or
                    deadline change; no work or sleep was removed.
                  </p>
                ))}
            </form>
          )}
        </>
      )}
      {task.status === "done" && (
        <>
          <p className="my-5 text-ink-2">
            {item.title} · {task.completedMinutes} minutes of planned work finished. Completion came from you, not the
            clock.
          </p>
          {!task.example && (
            <details className="mb-5 text-sm">
              <summary className="cursor-pointer">Record actual time for better estimates</summary>
              <form
                className="mt-4 flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number(actual);
                  if (!Number.isInteger(n) || n < 1 || n > 1200) return;
                  onRecord(task, n);
                }}
              >
                <label>
                  Total minutes you actually spent
                  <input
                    className={`${field} mt-2`}
                    type="number"
                    required
                    min={1}
                    max={1200}
                    value={actual}
                    onChange={(e) => setActual(e.target.value)}
                  />
                </label>
                <button disabled={logged} className={buttonClass("quiet")}>
                  {logged ? "Actual time recorded" : "Record actual time"}
                </button>
              </form>
            </details>
          )}
          <button
            className={buttonClass("primary", "min-h-12 w-full")}
            onClick={() => {
              if (!task.example) clearTask();
              onNewTask();
            }}
          >
            Plan another task
          </button>
        </>
      )}
      {deadline && <p className="mt-5 text-sm text-ink-2">Finish by {date(deadline)}</p>}
      <details className="mt-4 border-t border-line pt-4 text-sm">
        <summary className="cursor-pointer">
          {task.source ? "Where this deadline came from" : task.example ? "Example deadline" : "Deadline set by you"}
        </summary>
        {task.source ? (
          <>
            <p className="mt-3 text-ink-2">
              {sourceMatchesDeadline(task)
                ? task.source.time
                  ? "Matches the confirmed Lens source date and time."
                  : "The source provides the date. You chose the time."
                : "You changed the task or deadline. The source below is context; it does not verify your edited deadline."}
            </p>
            {task.source.evidence.map((e, n) => (
              <blockquote key={n} className="mt-3 border-l-2 border-crimson pl-3">
                <p>“{e.quote}”</p>
                <p className="mt-1 text-ink-2">
                  {e.source}
                  {e.page ? ` · page ${e.page}` : ""}
                </p>
                {e.computed_from && <p className="mt-1 text-ink-2">{e.computed_from}</p>}
              </blockquote>
            ))}
          </>
        ) : (
          <p className="mt-3 text-ink-2">
            {task.example
              ? "This deadline belongs to the made-up example week."
              : "This deadline was entered by you. Lens has not verified it against a document."}
          </p>
        )}
      </details>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer">Your plan & controls</summary>
        <div className="mt-4 flex flex-col gap-4">
          {task.plan.placements.map((p, n) => (
            <p key={n}>
              {p.minutes} minutes · {date(p.start)}
            </p>
          ))}
          {task.status === "active" && (
            <>
              <p>
                {task.remainingMinutes} remaining minutes planned; classes, sleep, and the deadline stay protected under
                your supplied availability.
              </p>
              <button disabled={stale} className={buttonClass("quiet")} onClick={download}>
                {stale ? "Update past times before exporting" : "Export remaining sessions"}
              </button>
              <p className="text-xs text-ink-2">
                Downloads a calendar file. Existing external events are not updated; check duplicates
                {task.plan.moved.length ? " and update the other moved task yourself" : ""}.
              </p>
            </>
          )}
          {previous && (
            <button
              className={buttonClass("quiet")}
              onClick={() => {
                const restore = previous;
                onChange(restore);
                setPrevious(null);
                setLeft(restore.remainingMinutes);
                setChanging(false);
                setPreview(null);
                setMessage("Last update undone.");
                try {
                  keepTask(restore, remember);
                } catch {
                  setError("Undo worked here but could not be saved.");
                }
              }}
            >
              Undo last update
            </button>
          )}
          {task.revision === 0 && (
            <button
              className={buttonClass("plain")}
              onClick={() => {
                if (!task.example) clearTask();
                onUndoPlan();
              }}
            >
              Back to plan choices
            </button>
          )}
          {!task.example && (
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => {
                  try {
                    keepTask(task, e.target.checked);
                    setRemember(e.target.checked);
                    setError("");
                  } catch {
                    setError("This browser could not save your task.");
                  }
                }}
              />
              Remember this task on this device
            </label>
          )}
          <p className="text-xs text-ink-2">
            {task.example
              ? "The example never replaces a saved personal task."
              : remember
                ? "Saved only in this browser. No account or cross-device sync. Starting another task replaces this one."
                : "Kept in this tab for this visit. Turn on remembering to return after closing it."}
          </p>
          <button
            className={buttonClass("plain")}
            onClick={() => {
              if (!task.example) clearTask();
              onNewTask();
            }}
          >
            Clear this task
          </button>
        </div>
      </details>
    </section>
  );
}
