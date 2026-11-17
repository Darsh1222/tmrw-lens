"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import REBUILDS from "@/lib/demo/rebuilds.json";
import { RebuildRequest } from "@/lib/rebuild/contract";
import { ImportRequest } from "@/lib/tomorrow/contract";
import {
  emptyMemory,
  Memory,
  recover,
  proposalProblems,
  type RecoveryInput,
  type RecoveryResult,
  type Obstacle,
} from "@/lib/recovery/engine";
import { MEMORY_KEY, WORKSPACE_KEY, type Setup } from "@/lib/recovery/workspace";
import { beginNextTask, sourceForTask, type NextTask, type TaskSource } from "@/lib/recovery/next-step";
import { NextStepCard, returningTask, keepTask, clearTask } from "./NextStepCard";
import type { ScheduleSnapshot } from "@/lib/recovery/schedule";
import type { Proposal } from "@/lib/recovery/engine";
import { AnimatePresence, motion } from "motion/react";
import { preferredProposal } from "@/lib/recovery/presentation";
import { RecoveryNote, emptyNoteDraft } from "./RecoveryNote";
import { readRecoveryNote, requestWithNote, type RecoveryNoteSettings } from "@/lib/recovery/note";
import { currentWeek } from "../_workspace/week-store";
import { buildWeekRequest } from "@/lib/recovery/week";
import { buttonClass } from "../_lens/styles";

const field = "min-h-12 w-full rounded-xl border border-line-input bg-paper px-4 py-3 text-base";
const box = "rounded-2xl border border-line bg-card p-6 sm:p-8";
const subscribe = () => () => {};
const choices: [Obstacle, string, string][] = [
  ["tired", "I’m tired", "Give today some breathing room."],
  ["stuck", "I’m stuck", "Find a smaller way to begin."],
  ["interrupted", "Something came up", "Find another time that fits."],
  ["underestimated", "I need more time", "Update how much is left."],
];
function readMemory() {
  try {
    const value = localStorage.getItem(MEMORY_KEY);
    return value ? Memory.parse(JSON.parse(value)) : emptyMemory();
  } catch {
    return emptyMemory();
  }
}
function readImport() {
  try {
    const value = sessionStorage.getItem(WORKSPACE_KEY);
    return value ? ImportRequest.parse(JSON.parse(value)) : currentWeek().courses;
  } catch {
    return null;
  }
}
const local = (d: DateTime) => d.toFormat("yyyy-MM-dd'T'HH:mm");
function initialSetup(): Setup {
  const zone = currentWeek().courses?.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = DateTime.now().setZone(zone).startOf("minute");
  const prefs = currentWeek().tasks.at(-1)?.task.input.request.prefs;
  return {
    title: "",
    category: "study",
    minutes: 60,
    zone,
    now: local(now),
    due: local(now.plus({ days: 1 }).set({ hour: 17, minute: 0 })),
    busy: [],
    studyStart: prefs?.study_hours?.start ?? "09:00",
    studyEnd: prefs?.study_hours?.end ?? "21:00",
    sleepStart: prefs?.sleep?.start ?? "23:00",
    sleepEnd: prefs?.sleep?.end ?? "07:00",
  };
}
type RecoveryProps = {
  mode?: "auto" | "example" | "personal";
  startWithExample?: boolean;
  onSchedule?: (snapshot: ScheduleSnapshot | null) => void;
  embedded?: boolean;
};
export function SimpleRecovery(props: RecoveryProps = {}) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return ready ? <RecoveryFlow {...props} /> : <p role="status">Opening your plan…</p>;
}
function demoFromLocation(mode: RecoveryProps["mode"], startWithExample: boolean) {
  const query = new URLSearchParams(window.location.search);
  if (
    mode === "personal" ||
    (mode !== "example" && !query.has("example") && (!startWithExample || readImport() || returningTask()))
  )
    return null;
  const obstacle: Obstacle = query.get("example") === "stuck" ? "stuck" : "tired";
  const request = RebuildRequest.parse(REBUILDS[0].request);
  const input: RecoveryInput = {
    request,
    obstacle,
    budget: 20,
    category: "problem sets",
    useEstimates: false,
    allowOneMove: false,
    memory: emptyMemory(),
  };
  const result = recover(input);
  return {
    obstacle,
    request,
    input,
    result,
    selected: preferredProposal(result, obstacle)?.id ?? "",
    step: mode !== "example" && query.get("view") === "plan" ? 2 : 1,
  };
}
function RecoveryFlow({ mode = "auto", startWithExample = false, onSchedule, embedded = false }: RecoveryProps) {
  const [demo] = useState(() => demoFromLocation(mode, startWithExample));
  const [active, setActive] = useState<NextTask | null>(() => (!demo && mode !== "personal" ? returningTask() : null));
  const [carriedSource, setCarriedSource] = useState<TaskSource | null>(active?.source ?? null);
  const [step, setStep] = useState(active ? 3 : (demo?.step ?? 0)),
    [setup, setSetup] = useState(initialSetup),
    [request, setRequest] = useState<RebuildRequest | null>(active?.input.request ?? demo?.request ?? null),
    [example, setExample] = useState(!!demo);
  const [obstacle, setObstacle] = useState<Obstacle>(demo?.obstacle ?? "unsure"),
    [budget, setBudget] = useState(20),
    [memory, setMemory] = useState(readMemory);
  const [remember, setRemember] = useState(() => {
    try {
      return !!localStorage.getItem(MEMORY_KEY);
    } catch {
      return false;
    }
  });
  const [payload, setPayload] = useState(readImport),
    [source, setSource] = useState("");
  const [calibrate, setCalibrate] = useState(false),
    [allowMove, setAllowMove] = useState(false);
  const [run, setRun] = useState<{ input: RecoveryInput; result: RecoveryResult } | null>(
      active
        ? { input: active.input, result: recover(active.input) }
        : demo
          ? { input: demo.input, result: demo.result }
          : null,
    ),
    [selected, setSelected] = useState(active?.plan.id ?? demo?.selected ?? "");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const selectedPlan = run?.result.proposals.find((p) => p.id === selected);
  const [noteDraft, setNoteDraft] = useState(emptyNoteDraft);
  const [noteSettings, setNoteSettings] = useState<RecoveryNoteSettings | null>(null);
  const [noteSummary, setNoteSummary] = useState(false);
  const [changePreview, setChangePreview] = useState<{ input: RecoveryInput; plan: Proposal } | null>(null);
  useEffect(() => {
    if (!onSchedule) return;
    if (active) {
      onSchedule({
        request: changePreview?.input.request ?? active.input.request,
        plan: changePreview?.plan ?? active.plan,
        previous: changePreview ? active.plan : null,
        phase: changePreview ? "preview" : active.status === "done" ? "done" : "active",
        example: active.example,
        completedMinutes: active.completedMinutes,
        baseline: demo?.request,
        taskId: active.id,
      });
    } else if (request) {
      onSchedule({
        request: step === 2 && run ? run.input.request : request,
        plan: step === 2 ? (selectedPlan ?? null) : null,
        phase: step === 2 ? "preview" : "before",
        example,
        completedMinutes: 0,
        baseline: demo?.request,
      });
    } else onSchedule(null);
  }, [onSchedule, active, changePreview, request, run, step, selectedPlan, example, demo]);
  const date = (s: string) =>
    DateTime.fromISO(s, { zone: request?.zone ?? setup.zone }).toFormat("ccc, LLL d · h:mm a");
  const time = (s: string) => DateTime.fromISO(s, { zone: request?.zone ?? setup.zone }).toFormat("h:mm a");
  const updateMemory = (m: Memory) => {
    const checked = Memory.parse(m);
    setMemory(checked);
    if (remember)
      try {
        localStorage.setItem(MEMORY_KEY, JSON.stringify(checked));
      } catch {
        setError("Your changes work for this visit, but could not be saved in this browser.");
      }
  };
  const compare = () => {
    if (!request) return;
    try {
      let settings = noteSettings;
      let nextObstacle = obstacle,
        nextBudget = budget,
        nextCalibrate = calibrate;
      if (noteDraft.text.trim() && !noteDraft.applied) {
        const reading = readRecoveryNote(noteDraft.text, request);
        setNoteDraft({ ...noteDraft, reading, applied: !reading.questions.length });
        if (reading.questions.length) {
          flowElement.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
          return;
        }
        settings = reading.settings;
        nextObstacle = settings.obstacle ?? obstacle;
        nextBudget = settings.starterMinutes ?? budget;
        if (settings.remainingMinutes !== undefined) nextCalibrate = false;
        setNoteSettings(settings);
        setObstacle(nextObstacle);
        setBudget(nextBudget);
        setCalibrate(nextCalibrate);
      }
      const input: RecoveryInput = {
        request: settings ? requestWithNote(request, settings) : request,
        obstacle: nextObstacle,
        budget: nextBudget,
        category: setup.category,
        useEstimates: nextCalibrate,
        allowOneMove: allowMove,
        memory,
      };
      const result = recover(input);
      setRun({ input, result });
      setSelected(preferredProposal(result, nextObstacle)?.id ?? "");
      setError("");
      setNotice("");
      setNoteSummary(!!settings);
      setStep(2);
    } catch {
      setError("Please check the task, deadline, and available times, then try again.");
    }
  };
  const apply = () => {
    if (!run || !selectedPlan) return;
    if (proposalProblems(run.input, selectedPlan).length) {
      setError("This plan needs another check. Go back and compare again.");
      return;
    }
    const next = beginNextTask(run.input, selectedPlan, sourceForTask(payload, source) ?? carriedSource, example);
    if (!example && currentWeek().tasks.some((x) => x.task.id === next.id))
      next.id = `${next.id.slice(0, 38)}_${crypto.randomUUID()}`;
    try {
      keepTask(next, !!localStorage.getItem("lens_next_step_v1"));
      if (!example) sessionStorage.removeItem(WORKSPACE_KEY);
    } catch {
      setError(
        "This plan could not be saved. Another saved task may use this time, or browser storage may be unavailable. Find a new plan and try again.",
      );
      return;
    }
    setActive(next);
    setStep(3);
    setNotice("");
  };
  const reset = () => {
    setActive(null);
    setChangePreview(null);
    setNoteSettings(null);
    setNoteDraft(emptyNoteDraft());
    setNoteSummary(false);
    setCarriedSource(null);
    setSetup(initialSetup());
    setPayload(null);
    setSource("");
    setStep(0);
    setRequest(null);
    setRun(null);
    setError("");
    setNotice("");
  };
  const flowElement = useRef<HTMLDivElement>(null);
  const focusedStep = useRef(step);
  const task = request?.items.find((i) => i.id === request.missed.item_id);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        ref={flowElement}
        onAnimationComplete={() => {
          if (focusedStep.current === step) return;
          focusedStep.current = step;
          const flow = flowElement.current;
          const heading = flow?.querySelector<HTMLElement>("h2");
          if (heading) {
            heading.tabIndex = -1;
            heading.focus({ preventScroll: true });
          }
          if (flow && flow.getBoundingClientRect().top < 80) flow.scrollIntoView({ block: "start" });
        }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className={`mx-auto flex w-full max-w-[780px] flex-col gap-5 ${embedded ? "workbench-flow" : "pb-16"}`}
      >
        {step < 3 && example && (
          <ol aria-label="Your progress" className="recovery-progress">
            {["Your task", "What happened", "Your plan"].map((label, n) => (
              <li
                key={label}
                aria-current={Math.min(step, 2) === n ? "step" : undefined}
                className={`flex flex-1 items-center gap-2 border-b-2 pb-3 ${Math.min(step, 2) === n ? "border-crimson text-ink" : "border-line"}`}
              >
                <span className="text-xs">{n + 1}</span>
                {label}
              </li>
            ))}
          </ol>
        )}
        {example && step > 0 && step < 3 && (
          <p className="example-caption">Example week · Nov 4–6, 2026 · no personal data</p>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-crimson bg-card p-4 text-sm text-crimson">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-xl border border-line bg-well p-4 text-sm">
            {notice}
          </p>
        )}
        {step === 0 && (
          <section className={box} aria-labelledby="task-heading">
            <h2 id="task-heading" className="recovery-heading">
              What needs doing?
            </h2>
            <p className="mb-6 mt-3 text-ink-2">One task is enough. We’ll find room for it.</p>
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const saved = currentWeek();
                  const zone = payload?.zone ?? saved.courses?.zone ?? setup.zone;
                  const fresh = { ...setup, zone, now: local(DateTime.now().setZone(zone).startOf("minute")) };
                  const request = buildWeekRequest(fresh, saved, payload ?? undefined);
                  const input: RecoveryInput = {
                    request,
                    obstacle: "unsure",
                    budget: 20,
                    category: fresh.category,
                    useEstimates: calibrate,
                    allowOneMove: false,
                    memory,
                  };
                  const result = recover(input);
                  setRequest(request);
                  setRun({ input, result });
                  setSelected(preferredProposal(result, "unsure")?.id ?? "");
                  setObstacle("unsure");
                  setSetup(fresh);
                  setExample(false);
                  setError("");
                  setStep(2);
                } catch {
                  setError("Choose a future deadline within 14 days, and check that busy times end after they start.");
                }
              }}
            >
              {payload && (
                <div className="rounded-xl border border-line bg-well p-4">
                  <label className="text-sm">
                    Choose from your reviewed deadlines
                    <select
                      className={`${field} mt-2`}
                      value={source}
                      onChange={(e) => {
                        setSource(e.target.value);
                        const item = payload.items.find((i) => i.lens_id === e.target.value);
                        if (!item || item.kind === "class_block") return;
                        setSetup({
                          ...setup,
                          zone: payload.zone,
                          title: item.title,
                          category: item.course ?? "study",
                          due: item.date ? `${item.date}T${item.start_time ?? "17:00"}` : setup.due,
                        });
                      }}
                    >
                      <option value="">Choose a task or deadline</option>
                      {payload.items
                        .filter((i) => i.kind !== "class_block")
                        .map((i) => (
                          <option key={i.lens_id} value={i.lens_id}>
                            {i.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="mt-2 text-xs text-ink-2">
                    Choose a deadline in the next 14 days. Confirm its time below; 5 PM is a suggestion when the source
                    gives only a date. Confirmed classes stay fixed.
                  </p>
                  {source && (
                    <details className="mt-3 text-sm">
                      <summary>Where this came from</summary>
                      <blockquote className="mt-2 border-l-2 border-crimson pl-3">
                        {payload.items
                          .find((i) => i.lens_id === source)
                          ?.evidence.map((e) => `${e.source}: “${e.quote}”`)
                          .join(" · ")}
                      </blockquote>
                    </details>
                  )}
                  <button
                    className={buttonClass("plain", "mt-2 px-0")}
                    type="button"
                    onClick={() => {
                      setPayload(null);
                      setSource("");
                    }}
                  >
                    Use a different task
                  </button>
                </div>
              )}
              <label className="text-sm">
                Task
                <input
                  required
                  maxLength={200}
                  placeholder="e.g. Finish my calculus practice"
                  className={`${field} mt-2`}
                  value={setup.title}
                  onChange={(e) => setSetup({ ...setup, title: e.target.value })}
                />
              </label>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="text-sm">
                  How much study time do you need?
                  <select
                    className={`${field} mt-2`}
                    value={setup.minutes}
                    onChange={(e) => setSetup({ ...setup, minutes: Number(e.target.value) })}
                  >
                    {[15, 30, 45, 60, 90, 120, 180, 240, 300, 600].map((m) => (
                      <option key={m} value={m}>
                        {m < 60 ? `${m} minutes` : `${m / 60} ${m === 60 ? "hour" : "hours"}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  When must it be finished?
                  <input
                    required
                    type="datetime-local"
                    className={`${field} mt-2`}
                    value={setup.due}
                    onChange={(e) => setSetup({ ...setup, due: e.target.value })}
                  />
                </label>
              </div>
              <p className="text-sm text-ink-2">
                Lens finds a complete plan around your saved classes and tasks, within {setup.studyStart ?? "09:00"}–
                {setup.studyEnd ?? "21:00"}. Review the proposed times before saving.
              </p>
              <details className="rounded-xl border border-line p-4 text-sm">
                <summary className="cursor-pointer font-medium">Check when you’re free</summary>
                <p className="mt-2 text-ink-2">Times are in {payload?.zone ?? setup.zone}.</p>
                <p className="my-3 text-ink-2">
                  We start with 9 AM–9 PM and protect sleep from 11 PM–7 AM. Add any classes, shifts, or plans we don’t
                  know about. Recovery also keeps the existing 90-minute pause after a nonurgent missed session.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["studyStart", "Study from", "09:00"],
                      ["studyEnd", "Study until", "21:00"],
                      ["sleepStart", "Bedtime", "23:00"],
                      ["sleepEnd", "Wake time", "07:00"],
                    ] as const
                  ).map(([key, label, fallback]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="time"
                        required
                        className={`${field} mt-1`}
                        value={setup[key] ?? fallback}
                        onChange={(e) => setSetup({ ...setup, [key]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
                <label className="mt-3 block">
                  Time zone
                  <input
                    required
                    disabled={!!payload}
                    className={`${field} mt-1`}
                    value={setup.zone}
                    onChange={(e) => setSetup({ ...setup, zone: e.target.value })}
                  />
                </label>
                <fieldset className="mt-4 flex flex-col gap-3">
                  <legend className="mb-2 font-medium">Busy times</legend>
                  {setup.busy.map((b, n) => (
                    <div key={n} className="flex flex-col gap-2 rounded-lg border border-line p-3">
                      <input
                        aria-label={`Busy time ${n + 1} name`}
                        required
                        className={field}
                        value={b.title}
                        onChange={(e) =>
                          setSetup({
                            ...setup,
                            busy: setup.busy.map((x, k) => (n === k ? { ...x, title: e.target.value } : x)),
                          })
                        }
                      />
                      <label>
                        Starts
                        <input
                          type="datetime-local"
                          required
                          className={`${field} mt-1`}
                          value={b.start}
                          onChange={(e) =>
                            setSetup({
                              ...setup,
                              busy: setup.busy.map((x, k) => (n === k ? { ...x, start: e.target.value } : x)),
                            })
                          }
                        />
                      </label>
                      <label>
                        Ends
                        <input
                          type="datetime-local"
                          required
                          className={`${field} mt-1`}
                          value={b.end}
                          onChange={(e) =>
                            setSetup({
                              ...setup,
                              busy: setup.busy.map((x, k) => (n === k ? { ...x, end: e.target.value } : x)),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className={buttonClass("plain")}
                        onClick={() => setSetup({ ...setup, busy: setup.busy.filter((_, k) => k !== n) })}
                      >
                        Remove this busy time
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={buttonClass("quiet", "self-start")}
                    disabled={setup.busy.length >= 100}
                    onClick={() => {
                      const now = DateTime.now().setZone(setup.zone).startOf("hour");
                      setSetup({
                        ...setup,
                        busy: [
                          ...setup.busy,
                          { title: "Class or other plan", start: local(now), end: local(now.plus({ hours: 1 })) },
                        ],
                      });
                    }}
                  >
                    Add a busy time
                  </button>
                </fieldset>
              </details>
              <button className={buttonClass("primary", "min-h-12 w-full text-base")} type="submit">
                Find the best available time
              </button>
            </form>
            <div className="mt-6 border-t border-line pt-5 text-center">
              <button
                className="text-sm underline decoration-crimson underline-offset-4"
                onClick={() => {
                  setRequest(RebuildRequest.parse(REBUILDS[0].request));
                  setExample(true);
                  setSetup({ ...setup, category: "problem sets" });
                  setStep(1);
                  setError("");
                }}
              >
                Just looking? Try the example
              </button>
            </div>
          </section>
        )}
        {step === 1 && (
          <section className={`${box} recovery-checkin`} aria-labelledby="obstacle-heading">
            <h2 id="obstacle-heading" className="recovery-heading">
              What got in the way?
            </h2>
            <p className="mb-6 mt-3 text-ink-2">{task?.title} · Choose what would help, or add a note.</p>
            {request && (
              <RecoveryNote
                draft={noteDraft}
                onDraftChange={setNoteDraft}
                onClear={() => {
                  setNoteSettings(null);
                  setObstacle(demo?.obstacle ?? "unsure");
                  setBudget(20);
                }}
              />
            )}
            <fieldset className="obstacle-options">
              <legend className="sr-only">What happened</legend>
              {choices.map(([id, title, help]) => (
                <label key={id} className={`obstacle-choice ${obstacle === id ? "is-selected" : ""}`}>
                  <input
                    type="radio"
                    name="obstacle"
                    value={id}
                    checked={obstacle === id}
                    onClick={() => {
                      setNoteSettings(null);
                      setNoteDraft(emptyNoteDraft());
                    }}
                    onChange={() => {
                      setObstacle(id);
                      setNoteSettings(null);
                      setNoteDraft(emptyNoteDraft());
                    }}
                  />
                  <span>
                    <strong className="font-medium">{title}</strong>
                    <span className="sr-only">{help}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {obstacle === "stuck" && (
              <details className="first-step-settings">
                <summary>First step: up to {budget} minutes</summary>
                <fieldset>
                  <legend className="mb-3 text-sm">First step: how long feels manageable?</legend>
                  <div className="flex gap-3">
                    {Array.from(new Set([10, 20, 30, budget]))
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={budget === m}
                          className={buttonClass(budget === m ? "primary" : "quiet", "flex-1")}
                          onClick={() => {
                            setBudget(m);
                            if (noteSettings) setNoteSettings({ ...noteSettings, starterMinutes: m });
                          }}
                        >
                          {m} min
                        </button>
                      ))}
                  </div>
                  <p className="mt-2 text-xs text-ink-2">This limits the first step, not the rest of your work.</p>
                </fieldset>
              </details>
            )}
            {obstacle === "underestimated" && (
              <label className="mt-6 block text-sm">
                How many minutes are still needed?
                <input
                  className={`${field} mt-2`}
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  value={
                    noteSettings?.remainingMinutes ??
                    (request ? Math.round((Date.parse(task!.end) - Date.parse(task!.start)) / 60000) : 60)
                  }
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    if (!request || !Number.isInteger(m) || m < 5 || m > 600) return;
                    if (noteSettings) setNoteSettings({ ...noteSettings, remainingMinutes: m });
                    setRequest({
                      ...request,
                      items: request.items.map((i) =>
                        i.id === task?.id ? { ...i, start: new Date(Date.parse(i.end) - m * 60000).toISOString() } : i,
                      ),
                    });
                  }}
                />
              </label>
            )}
            {obstacle === "interrupted" && !noteSettings?.freeAgainAt && (
              <p className="mt-5 rounded-xl bg-well p-4 text-sm">
                Make sure the interruption is included in your busy times.{" "}
                <button
                  className="underline"
                  onClick={() => {
                    setNotice("");
                    setNoteSettings(null);
                    setNoteDraft(emptyNoteDraft());
                    setStep(0);
                  }}
                >
                  Check availability
                </button>
              </p>
            )}
            <button className={buttonClass("primary", "mt-6 min-h-12 w-full text-base")} onClick={compare}>
              Preview my plan
            </button>
            <p className="approval-hint">Review the changes before you apply them.</p>
            <button
              className={buttonClass("plain", "mt-2 w-full")}
              onClick={() => {
                setNotice("");
                setNoteSettings(null);
                setNoteDraft(emptyNoteDraft());
                setStep(0);
              }}
            >
              Back to my task
            </button>
          </section>
        )}
        {step === 2 && run && (
          <section className={box} aria-labelledby="plan-heading">
            <h2 id="plan-heading" className="recovery-heading">
              {selectedPlan
                ? obstacle === "tired" && selectedPlan.id === "tomorrow"
                  ? "Keep tonight free."
                  : selectedPlan.id === "starter"
                    ? "Start with one small step."
                    : "Here’s room for your task."
                : "This doesn’t fit yet."}
            </h2>
            {selectedPlan ? (
              <>
                <p className="mb-5 mt-3 text-ink-2">
                  {selectedPlan.id === "tomorrow"
                    ? "Pick it up tomorrow, with the whole task accounted for."
                    : selectedPlan.id === "starter"
                      ? "Begin small. The rest is still in the plan."
                      : "Your other commitments stay protected."}
                </p>
                {noteSummary && (
                  <div className="note-plan-summary">
                    <h3>From your note</h3>
                    {noteSettings?.todayMinutes !== undefined && (
                      <p className="mt-2">At most {noteSettings.todayMinutes} minutes for this task today.</p>
                    )}
                    {noteSettings?.freeAgainAt && (
                      <p className="mt-2">No sessions before {date(noteSettings.freeAgainAt)}.</p>
                    )}
                    {noteSettings?.remainingMinutes !== undefined && (
                      <p className="mt-2">All {noteSettings.remainingMinutes} remaining minutes accounted for.</p>
                    )}
                    <p className="mt-2 text-xs text-ink-2">Your deadline and existing commitments are preserved.</p>
                  </div>
                )}
                <div className="plan-sessions">
                  <h3 className="mb-4 text-xl font-medium">{task?.title}</h3>
                  <ol className="flex flex-col gap-4">
                    {selectedPlan.placements.map((p, n) => (
                      <li key={n} className="flex gap-4">
                        <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-crimson" aria-hidden />
                        <span>
                          <strong className="font-medium">{date(p.start)}</strong>
                          <span className="mt-1 block text-sm text-ink-2">
                            {p.minutes} minutes{p.starter ? " · first step" : ""} · ends {time(p.end)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
                <p className="mt-4 text-sm">
                  All {selectedPlan.required} minutes planned ·{" "}
                  {selectedPlan.otherChanges === 0
                    ? "No other tasks moved"
                    : `${selectedPlan.otherChanges} other task moves`}
                </p>
                {selectedPlan.moved.map((p) => (
                  <p key={p.itemId} className="mt-2 text-sm">
                    Also moves {p.title} to {date(p.start)}.
                  </p>
                ))}
                <button className={buttonClass("primary", "mt-6 min-h-12 w-full text-base")} onClick={apply}>
                  Use this plan
                </button>
                <details className="mt-5 border-t border-line pt-4 text-sm">
                  <summary className="cursor-pointer">See other ways to do it</summary>
                  <div className="mt-3 flex flex-col gap-2">
                    {run.result.proposals
                      .filter((p) => p.id !== selectedPlan.id)
                      .map((p) => (
                        <button
                          className={buttonClass("quiet", "justify-start text-left")}
                          key={p.id}
                          onClick={() => setSelected(p.id)}
                        >
                          {p.title}
                        </button>
                      ))}
                  </div>
                  <p className="mt-3 text-ink-2">{selectedPlan.tradeoff}</p>
                </details>
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer">Why this plan fits</summary>
                  <p className="mt-3 text-ink-2">
                    {selectedPlan.why} Each session fits your loaded free time, avoids fixed commitments and sleep, and
                    ends before the deadline. Nothing changes until you choose Use this plan.
                  </p>
                  <p className="mt-2 text-ink-2">
                    {run.result.estimate.used
                      ? `Effort estimate uses ${run.result.estimate.samples} completions in this work category. It is a bounded heuristic, not a guarantee.`
                      : "This plan uses your remaining-work estimate."}
                  </p>
                </details>
              </>
            ) : (
              <>
                <p className="mt-4 text-ink-2">
                  Your task needs {run.result.estimate.minutes} minutes. We found {run.result.availableMinutes}{" "}
                  available minutes before its deadline while keeping other plans fixed.
                </p>
                <p className="mt-4 font-medium">
                  {run.result.shortfallMinutes > 0
                    ? `${run.result.shortfallMinutes} minutes still need room.`
                    : "The available gaps don’t form a complete plan under these settings."}
                </p>
                <p className="mt-3 text-sm text-ink-2">
                  Try changing availability, checking the estimate, asking for help with scope, or requesting an
                  extension. Lens won’t drop work or borrow sleep to make it fit. This search is limited to your loaded
                  windows and up to eight sessions.
                </p>
              </>
            )}
            <button
              className={buttonClass("plain", "mt-4 w-full")}
              onClick={() => {
                setNotice("");
                setStep(1);
              }}
            >
              Change what happened
            </button>
            <button
              className="mt-2 block w-full text-center text-sm underline underline-offset-4"
              onClick={() => {
                setNotice("");
                setNoteSettings(null);
                setNoteDraft(emptyNoteDraft());
                setStep(0);
              }}
            >
              Edit my task or availability
            </button>
          </section>
        )}
        {step === 3 && active && (
          <NextStepCard
            task={active}
            onPreview={setChangePreview}
            onChange={(next) => {
              setActive(next);
              if (next.status === "active" && memory.history.some((h) => h.id === next.id))
                updateMemory({ ...memory, history: memory.history.filter((h) => h.id !== next.id) });
            }}
            onNewTask={reset}
            onUndoPlan={() => {
              if (!active.example) clearTask();
              setChangePreview(null);
              setCarriedSource(active.source);
              setActive(null);
              const input = active.input;
              const result = recover(input);
              setRequest(input.request);
              setRun({ input, result });
              setSelected(preferredProposal(result, input.obstacle)?.id ?? "");
              setStep(2);
            }}
            logged={memory.history.some((h) => h.id === active.id)}
            onRecord={(task, actual) => {
              if (task.example || task.status !== "done" || memory.history.some((h) => h.id === task.id)) return;
              updateMemory({
                ...memory,
                history: [
                  ...memory.history,
                  {
                    id: task.id,
                    category: task.category,
                    estimated: task.originalEstimateMinutes,
                    actual,
                    at: new Date().toISOString(),
                  },
                ].slice(-100),
              });
              setNotice("Actual time recorded from your report.");
            }}
          />
        )}
        <section className="planning-preferences" aria-labelledby="preferences-heading">
          <h2 id="preferences-heading">Planning preferences</h2>
          <p>Fine-tune future suggestions. Your saved schedule stays in place.</p>
          <div className="preferences-controls">
            <p className="text-ink-2">
              Learning history stays temporary unless you save it below. Approved tasks and your reviewed schedule are
              saved separately on this device.
            </p>
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => {
                  try {
                    if (e.target.checked) localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
                    else localStorage.removeItem(MEMORY_KEY);
                    setRemember(e.target.checked);
                  } catch {
                    setError("This browser could not save your preferences.");
                  }
                }}
              />
              Remember my learning history in this browser
            </label>
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={calibrate}
                onChange={(e) => {
                  setCalibrate(e.target.checked);
                  if (step === 2) setStep(1);
                }}
              />
              Use my actual completion times to improve estimates
            </label>
            <p className="text-xs text-ink-2">
              Estimates become available after you record actual time for three completed tasks of the same type. You
              can inspect or delete those records below.
            </p>
            <label>
              Type of work
              <input
                className={`${field} mt-1`}
                maxLength={60}
                value={setup.category}
                onChange={(e) => {
                  setSetup({ ...setup, category: e.target.value });
                  if (step === 2) setStep(1);
                }}
              />
            </label>
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={memory.preferDaytime}
                onChange={(e) => {
                  updateMemory({ ...memory, preferDaytime: e.target.checked });
                  if (step === 2) setStep(1);
                }}
              />
              Finish sessions before 9 PM
            </label>
            <label className="flex gap-3" hidden={embedded}>
              <input
                type="checkbox"
                checked={allowMove}
                onChange={(e) => {
                  setAllowMove(e.target.checked);
                  if (step === 2) setStep(1);
                }}
              />
              Let me compare moving one other flexible task
            </label>
            <p>
              {memory.history.length} completion records · {memory.rejected.length} rejected start times
            </p>
            {memory.history.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <span>
                  {h.category}: {h.estimated} min estimated, {h.actual} min actual
                </span>
                <button
                  className={buttonClass("plain")}
                  onClick={() => updateMemory({ ...memory, history: memory.history.filter((x) => x.id !== h.id) })}
                >
                  Delete record
                </button>
              </div>
            ))}
            {memory.rejected.map((r) => (
              <div key={r.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {r.hour}:00 · {r.reason}
                </span>
                <button
                  onClick={() => updateMemory({ ...memory, rejected: memory.rejected.filter((x) => x.id !== r.id) })}
                >
                  Forget this feedback
                </button>
              </div>
            ))}
            {step === 2 && selectedPlan && (
              <button
                className={buttonClass("quiet")}
                onClick={() => {
                  updateMemory({
                    ...memory,
                    rejected: [
                      ...memory.rejected,
                      {
                        id: crypto.randomUUID(),
                        hour: DateTime.fromISO(selectedPlan.placements[0].start, { zone: request!.zone }).hour,
                        reason: "This start hour did not suit me",
                      },
                    ].slice(-50),
                  });
                  setNotice("Feedback recorded. Recompare to try this hour later in the default option’s search.");
                  setStep(1);
                }}
              >
                Remember that this start time doesn’t suit me
              </button>
            )}
            <button
              className={buttonClass("quiet")}
              onClick={() => {
                try {
                  localStorage.removeItem(MEMORY_KEY);
                  sessionStorage.removeItem(WORKSPACE_KEY);
                  setMemory(emptyMemory());
                  setRemember(false);
                  setPayload(null);
                  setNotice("Your saved history and waiting import are cleared. The current plan stays on this page.");
                  if (step === 2) setStep(1);
                } catch {
                  setError("This browser could not clear saved history.");
                }
              }}
            >
              Forget all learning history
            </button>
            <Link href="/recover/details" className="underline underline-offset-4">
              Open the detailed planner
            </Link>
          </div>
        </section>
        <p className="text-center text-xs text-ink-2">
          Plans are checked against the information you provide. This workspace stays in your browser; it does not send
          texts or sync an external calendar.
        </p>
      </motion.div>
    </AnimatePresence>
  );
}
