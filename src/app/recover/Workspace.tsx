"use client";

import { useState, useSyncExternalStore } from "react";
import { DateTime } from "luxon";
import Link from "next/link";
import REBUILDS from "@/lib/demo/rebuilds.json";
import { RebuildRequest } from "@/lib/rebuild/contract";
import { ImportRequest } from "@/lib/tomorrow/contract";
import {
  emptyMemory,
  Memory,
  Obstacles,
  proposalProblems,
  recover,
  suggestObstacle,
  type Obstacle,
  type Proposal,
  type RecoveryInput,
  type RecoveryResult,
} from "@/lib/recovery/engine";
import {
  completionKey,
  applyProposal,
  buildRequest,
  MEMORY_KEY,
  recoveryCalendar,
  WORKSPACE_KEY,
  type Setup,
} from "@/lib/recovery/workspace";
import { buttonClass } from "../_lens/styles";

const LABEL: Record<Obstacle, string> = {
  unsure: "Not sure / something else",
  stuck: "I’m stuck on the task",
  tired: "I’m tired or overwhelmed",
  interrupted: "Something interrupted me",
  underestimated: "It needs more time",
};
const field = "min-h-11 w-full rounded-lg border border-line-input bg-paper px-3 py-2 text-sm";
const panel = "flex flex-col gap-4 rounded-2xl border border-line bg-card p-5 sm:p-6";
const sample = () => RebuildRequest.parse(REBUILDS[0].request);
const explainError = (e: unknown) => (e instanceof Error ? e.message : "Please check the inputs.");
const download = (data: string, type: string, name: string) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const localInput = (d: DateTime) => d.toFormat("yyyy-MM-dd'T'HH:mm");

type Comparison = { input: RecoveryInput; result: RecoveryResult };
const subscribe = () => () => {};
export function Workspace() {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return inBrowser ? (
    <RecoveryWorkspace />
  ) : (
    <p role="status" className="text-sm text-ink-2">
      Opening your recovery workspace…
    </p>
  );
}
function RecoveryWorkspace() {
  const [request, setRequest] = useState(sample);
  const [example, setExample] = useState(true);
  const [reply, setReply] = useState("");
  const [obstacle, setObstacle] = useState<Obstacle>("unsure");
  const [budget, setBudget] = useState(20);
  const [category, setCategory] = useState("problem sets");
  const [useEstimates, setUseEstimates] = useState(false);
  const [allowMove, setAllowMove] = useState(false);
  const [memory, setMemory] = useState<Memory>(emptyMemory);
  const [remember, setRemember] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [applied, setApplied] = useState<Proposal | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [json, setJson] = useState("");
  const [payload, setPayload] = useState<ImportRequest | null>(null);
  const [selectedSource, setSelectedSource] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [actual, setActual] = useState(60);
  const [logged, setLogged] = useState(false);
  const [rejectReason, setRejectReason] = useState("This start time doesn’t work for me");

  const invalidate = () => {
    setComparison(null);
    setApplied(null);
    setError("");
    setNotice("");
    setLogged(false);
  };
  const changeMemory = (next: Memory) => {
    const checked = Memory.parse(next);
    if (remember)
      try {
        localStorage.setItem(MEMORY_KEY, JSON.stringify(checked));
      } catch {
        setError("Memory changed for this visit, but browser storage could not save it.");
      }
    setMemory(checked);
  };
  const startOwn = () => {
    invalidate();
    setPayload(null);
    setSelectedSource("");
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = DateTime.now().setZone(zone).startOf("minute");
    setSetup({
      title: "",
      category: "study",
      minutes: 60,
      zone,
      now: localInput(now),
      due: localInput(now.plus({ days: 2 }).set({ hour: 17, minute: 0 })),
      busy: [],
    });
  };
  const loadHandoff = () => {
    try {
      const raw = sessionStorage.getItem(WORKSPACE_KEY);
      if (!raw) throw new Error("No verified import is waiting. Open your Lens plan and choose Make a study plan.");
      const data = ImportRequest.parse(JSON.parse(raw));
      invalidate();
      setPayload(data);
      setSelectedSource("");
      const now = DateTime.now().setZone(data.zone).startOf("minute");
      setSetup({
        title: "",
        category: "study",
        minutes: 60,
        zone: data.zone,
        now: localInput(now),
        due: localInput(now.plus({ days: 2 }).set({ hour: 17, minute: 0 })),
        busy: [],
      });
      setNotice(
        "Verified source loaded for this visit. Select a task and confirm its deadline and remaining effort. Imported classes will remain fixed.",
      );
    } catch (e) {
      setError(explainError(e));
    }
  };
  const calculate = () => {
    try {
      const input: RecoveryInput = {
        request: { ...request, missed: { ...request.missed, reply: reply.trim() || null } },
        obstacle,
        budget,
        category,
        useEstimates,
        allowOneMove: allowMove,
        memory,
      };
      const result = recover(input);
      setComparison({ input, result });
      setApplied(null);
      setError("");
      setNotice("");
      setLogged(false);
    } catch (e) {
      setError(explainError(e));
    }
  };
  const apply = (p: Proposal) => {
    if (!comparison) return;
    const problems = proposalProblems(comparison.input, p);
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setApplied(p);
    setNotice(
      "Applied to this workspace only. Your source documents and external calendars have not changed. Undo is available.",
    );
  };
  const timestamp = (s: string) => DateTime.fromISO(s, { zone: request.zone }).toFormat("ccc LLL d, h:mm a");
  const result = comparison?.result;
  const missed = request.items.find((i) => i.id === request.missed.item_id)!;
  const completionId = completionKey(request);
  const alreadyRecorded = memory.history.some((h) => h.id === completionId);
  const deadline = missed.due ?? request.deadlines.find((d) => d.id === missed.for)?.due;
  const plan = applied ? applyProposal(request, applied) : request.items;

  return (
    <div className="flex flex-col gap-10">
      <section className={panel} aria-labelledby="week-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="forum-caps">01 · Your week</span>
            <h2 id="week-title" className="forum-display mt-2 text-3xl">
              What needs recovering?
            </h2>
          </div>
          <span className="rounded-full bg-well px-3 py-2 text-xs">
            {example ? "Synthetic example · Nov 4–6, 2026" : "Your loaded week · this visit only"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClass("quiet")}
            onClick={() => {
              invalidate();
              setRequest(sample());
              setExample(true);
              setSetup(null);
              setPayload(null);
            }}
          >
            Use example week
          </button>
          <button className={buttonClass("quiet")} onClick={startOwn}>
            Use my own week
          </button>
          <button className={buttonClass("quiet")} onClick={loadHandoff}>
            Load verified Lens handoff
          </button>
          <Link href="/#upload" className={buttonClass("plain")}>
            Read a syllabus or photo
          </Link>
        </div>
        {setup && (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const req = buildRequest(setup, payload ?? undefined);
                invalidate();
                setRequest(req);
                setCategory(setup.category);
                setExample(false);
                setSetup(null);
              } catch (err) {
                setError(explainError(err));
              }
            }}
          >
            {payload && (
              <div className="sm:col-span-2">
                <label className="text-sm">
                  Verified task or deadline
                  <select
                    className={field}
                    value={selectedSource}
                    onChange={(e) => {
                      setSelectedSource(e.target.value);
                      const item = payload.items.find((i) => i.lens_id === e.target.value);
                      if (!item || item.kind === "class_block") return;
                      setSetup({
                        ...setup,
                        title: item.title,
                        category: item.course ?? "study",
                        due: item.date ? `${item.date}T${item.start_time ?? "17:00"}` : setup.due,
                      });
                    }}
                  >
                    <option value="">Choose a source item</option>
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
                  A date without a time uses a proposed 5 PM value below; confirm or change it before loading.
                  Unverified items are excluded.
                </p>
                {selectedSource && (
                  <blockquote className="mt-3 border-l-2 border-crimson pl-3 text-sm">
                    {payload.items
                      .find((i) => i.lens_id === selectedSource)
                      ?.evidence.map((e) => `${e.source}: “${e.quote}”`)
                      .join(" · ")}
                  </blockquote>
                )}
              </div>
            )}
            <label className="text-sm">
              Task title
              <input
                required
                maxLength={200}
                className={field}
                value={setup.title}
                onChange={(e) => setSetup({ ...setup, title: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Work category
              <input
                required
                maxLength={60}
                className={field}
                value={setup.category}
                onChange={(e) => setSetup({ ...setup, category: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Remaining estimate (minutes)
              <input
                type="number"
                required
                min={5}
                max={600}
                step={5}
                className={field}
                value={setup.minutes}
                onChange={(e) => setSetup({ ...setup, minutes: Number(e.target.value) })}
              />
            </label>
            <label className="text-sm">
              IANA time zone
              <input
                required
                disabled={!!payload}
                className={field}
                value={setup.zone}
                onChange={(e) => setSetup({ ...setup, zone: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Current local time
              <input
                type="datetime-local"
                required
                className={field}
                value={setup.now}
                onChange={(e) => setSetup({ ...setup, now: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Confirmed deadline
              <input
                type="datetime-local"
                required
                className={field}
                value={setup.due}
                onChange={(e) => setSetup({ ...setup, due: e.target.value })}
              />
            </label>
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-4">
              <label className="text-sm">
                Study from
                <input
                  type="time"
                  required
                  className={field}
                  value={setup.studyStart ?? "09:00"}
                  onChange={(e) => setSetup({ ...setup, studyStart: e.target.value })}
                />
              </label>
              <label className="text-sm">
                Study until
                <input
                  type="time"
                  required
                  className={field}
                  value={setup.studyEnd ?? "21:00"}
                  onChange={(e) => setSetup({ ...setup, studyEnd: e.target.value })}
                />
              </label>
              <label className="text-sm">
                Bedtime
                <input
                  type="time"
                  required
                  className={field}
                  value={setup.sleepStart ?? "23:00"}
                  onChange={(e) => setSetup({ ...setup, sleepStart: e.target.value })}
                />
              </label>
              <label className="text-sm">
                Wake time
                <input
                  type="time"
                  required
                  className={field}
                  value={setup.sleepEnd ?? "07:00"}
                  onChange={(e) => setSetup({ ...setup, sleepEnd: e.target.value })}
                />
              </label>
            </div>
            <p className="text-sm text-ink-2 sm:col-span-2">
              Initial defaults: daily 9 AM–9 PM, sleep 11 PM–7 AM. The planner also protects the hour before bed. Add
              every class, shift, or other busy block; unlisted commitments cannot be protected. The horizon is at most
              14 days. It does not sync your calendar automatically.
            </p>
            <fieldset className="flex flex-col gap-3 sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">Busy time to protect</legend>
              {setup.busy.map((w, n) => (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]" key={n}>
                  <input
                    aria-label={`Busy block ${n + 1} title`}
                    required
                    className={field}
                    value={w.title}
                    onChange={(e) =>
                      setSetup({
                        ...setup,
                        busy: setup.busy.map((b, k) => (k === n ? { ...b, title: e.target.value } : b)),
                      })
                    }
                  />
                  <input
                    aria-label={`Busy block ${n + 1} start`}
                    type="datetime-local"
                    required
                    className={field}
                    value={w.start}
                    onChange={(e) =>
                      setSetup({
                        ...setup,
                        busy: setup.busy.map((b, k) => (k === n ? { ...b, start: e.target.value } : b)),
                      })
                    }
                  />
                  <input
                    aria-label={`Busy block ${n + 1} end`}
                    type="datetime-local"
                    required
                    className={field}
                    value={w.end}
                    onChange={(e) =>
                      setSetup({
                        ...setup,
                        busy: setup.busy.map((b, k) => (k === n ? { ...b, end: e.target.value } : b)),
                      })
                    }
                  />
                  <button
                    type="button"
                    className={buttonClass("plain")}
                    onClick={() => setSetup({ ...setup, busy: setup.busy.filter((_, k) => k !== n) })}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={buttonClass("quiet", "self-start")}
                disabled={setup.busy.length >= 100}
                onClick={() =>
                  setSetup({ ...setup, busy: [...setup.busy, { title: "Busy", start: setup.now, end: setup.due }] })
                }
              >
                Add busy block
              </button>
            </fieldset>
            <button className={buttonClass("primary", "self-start")} type="submit">
              Confirm and load this week
            </button>
            <button
              className={buttonClass("plain")}
              type="button"
              onClick={() => {
                setSetup(null);
                setPayload(null);
              }}
            >
              Cancel setup
            </button>
          </form>
        )}
        {!setup && (
          <>
            <p className="text-lg">
              {missed.title} · {Math.ceil((Date.parse(missed.end) - Date.parse(missed.start)) / 60000)} minutes to
              recover
            </p>
            <p className="text-sm text-ink-2">
              Clock: {timestamp(request.now)} · {request.zone}.{" "}
              {deadline
                ? `Due ${timestamp(deadline)}.`
                : "No deadline supplied; options are limited to loaded windows."}
            </p>
            <details className="text-sm">
              <summary className="cursor-pointer">Inspect loaded commitments and availability</summary>
              <ul className="mt-3 flex flex-col gap-2">
                {request.fixed.map((f, n) => (
                  <li key={n}>
                    {f.title}: {timestamp(f.start)} – {timestamp(f.end)}
                  </li>
                ))}
                {request.open_windows.map((w, n) => (
                  <li key={`w${n}`} className="text-ink-2">
                    Available: {timestamp(w.start)} – {timestamp(w.end)}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer">Load a detailed week as JSON</summary>
          <p className="my-2 text-ink-2">
            Accepts the documented Lens rebuild request: one missed task, scheduled flexible tasks, fixed events,
            explicit windows, and preferences. Maximum 14 days. This runs in your browser.
          </p>
          <textarea
            aria-label="Week JSON"
            maxLength={150000}
            rows={5}
            className={field}
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          <button
            className={buttonClass("quiet", "mt-2")}
            onClick={() => {
              try {
                const r = RebuildRequest.parse(JSON.parse(json));
                recover({
                  request: r,
                  obstacle: "unsure",
                  budget: 20,
                  category,
                  useEstimates: false,
                  allowOneMove: false,
                  memory: emptyMemory(),
                });
                invalidate();
                setRequest(r);
                setExample(false);
                setSetup(null);
                setPayload(null);
              } catch (e) {
                setError(explainError(e));
              }
            }}
          >
            Validate and load JSON
          </button>
        </details>
      </section>

      <section className={panel} aria-labelledby="obstacle-title">
        <span className="forum-caps">02 · The obstacle</span>
        <h2 id="obstacle-title" className="forum-display text-3xl">
          What got in the way?
        </h2>
        <label className="text-sm">
          Your words (optional)
          <textarea
            rows={2}
            maxLength={280}
            className={field}
            value={reply}
            onChange={(e) => {
              invalidate();
              setReply(e.target.value);
            }}
            placeholder="I have 20 minutes, I’m exhausted, and I haven’t started."
          />
        </label>
        <button
          className={buttonClass("quiet", "self-start")}
          onClick={() => {
            invalidate();
            setObstacle(suggestObstacle(reply));
            setNotice(
              "Suggested from a few explicit words, not a model or diagnosis. Correct the choice below if it does not fit.",
            );
          }}
        >
          Suggest an obstacle from my words
        </button>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            Remaining work (minutes)
            <input
              type="number"
              min={5}
              max={600}
              step={5}
              className={field}
              value={Math.round((Date.parse(missed.end) - Date.parse(missed.start)) / 60000)}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (!Number.isFinite(value) || value < 5 || value > 600) return;
                invalidate();
                setRequest({
                  ...request,
                  items: request.items.map((i) =>
                    i.id === missed.id ? { ...i, start: new Date(Date.parse(i.end) - value * 60000).toISOString() } : i,
                  ),
                });
              }}
            />
          </label>
          <label className="text-sm">
            You choose the obstacle
            <select
              className={field}
              value={obstacle}
              onChange={(e) => {
                invalidate();
                setObstacle(e.target.value as Obstacle);
              }}
            >
              {Obstacles.map((o) => (
                <option key={o} value={o}>
                  {LABEL[o]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Maximum first-step length (minutes)
            <input
              type="number"
              min={5}
              max={120}
              step={5}
              className={field}
              value={budget}
              onChange={(e) => {
                invalidate();
                setBudget(Number(e.target.value));
              }}
            />
          </label>
          <label className="text-sm">
            Work category for effort learning
            <input
              required
              maxLength={60}
              className={field}
              value={category}
              onChange={(e) => {
                invalidate();
                setCategory(e.target.value);
              }}
            />
          </label>
        </div>
        <p className="text-xs text-ink-2">
          The first-step limit controls the small-start option, not your total availability. Add interruptions as busy
          time above; free-text replies do not silently change your calendar or availability.
        </p>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={useEstimates}
            onChange={(e) => {
              invalidate();
              setUseEstimates(e.target.checked);
            }}
          />
          Use my recorded effort estimates (at least 3 same-category completions)
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={allowMove}
            onChange={(e) => {
              invalidate();
              setAllowMove(e.target.checked);
            }}
          />
          Also compare moving at most one flexible task; fixed events never move
        </label>
        <button className={buttonClass("primary", "self-start")} onClick={calculate} disabled={!!setup}>
          Compare recovery plans
        </button>
      </section>

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
      {result && comparison && (
        <section className="flex flex-col gap-5" aria-labelledby="comparison-title">
          <span className="forum-caps">03 · Preview before applying</span>
          <h2 id="comparison-title" className="forum-display text-3xl">
            {result.message}
          </h2>
          <p className="text-ink-2">{result.nextStep}</p>
          <div className={panel}>
            <p>
              Effort: {result.estimate.base} min originally → {result.estimate.minutes} min in these plans.
            </p>
            <p className="text-sm text-ink-2">
              {result.estimate.used
                ? `Median of ${result.estimate.samples} same-category records, capped between 0.5× and 2×; this is a heuristic, not a promise.`
                : `${result.estimate.samples} same-category records. ${useEstimates ? "At least 3 are required before calibration." : "Calibration is off."}`}
            </p>
            <p className="text-sm">
              Keeping other tasks fixed: {result.availableMinutes} free minutes before the deadline or loaded horizon.
              Longest window: {result.longestMinutes} min. Work shortfall: {result.shortfallMinutes} min.
            </p>
          </div>
          {!result.proposals.length && (
            <div className={panel}>
              <h3 className="forum-display text-2xl">Make an explicit decision</h3>
              <p>
                Review availability or the remaining estimate, ask for help with scope, or request an extension. Lens
                will not change a deadline, remove work, or use sleep time to make the numbers fit.
              </p>
              <p className="text-sm text-ink-2">
                No result is not proof that the week is impossible: the search uses loaded windows, at most 8 sessions,
                and only one optional flexible-task move. Unloaded availability may change the result.
              </p>
            </div>
          )}
          <div className="grid items-start gap-5 lg:grid-cols-3">
            {result.proposals.map((p) => (
              <article className={panel} key={p.id}>
                <h3 className="forum-display text-2xl">{p.title}</h3>
                <p className="text-sm">{p.why}</p>
                <p className="text-sm text-ink-2">Trade-off: {p.tradeoff}</p>
                <ul className="flex flex-col gap-3">
                  {p.placements.map((s, n) => (
                    <li key={n} className="rounded-xl border border-line bg-well p-3 text-sm">
                      <strong>
                        {s.starter ? "First step" : "Work session"} · {s.minutes} min
                      </strong>
                      <br />
                      {timestamp(s.start)}
                      <br />
                      to {timestamp(s.end)}
                    </li>
                  ))}
                </ul>
                {p.moved.map((s) => (
                  <p key={s.itemId} className="text-sm">
                    Also moves {s.title}: {timestamp(s.start)} – {timestamp(s.end)}
                  </p>
                ))}
                <p className="text-xs text-ink-2">
                  {p.otherChanges} other tasks moved · {p.remaining} min unplanned · full required work accounted for
                </p>
                <button disabled={!!applied} className={buttonClass("primary")} onClick={() => apply(p)}>
                  Apply {p.title.toLowerCase()}
                </button>
                <button
                  disabled={!!applied}
                  className={buttonClass("plain")}
                  onClick={() => {
                    const first = p.placements[0];
                    changeMemory({
                      ...memory,
                      rejected: [
                        ...memory.rejected,
                        {
                          id: crypto.randomUUID(),
                          hour: DateTime.fromISO(first.start, { zone: request.zone }).hour,
                          reason: rejectReason.trim().slice(0, 140),
                        },
                      ].slice(-50),
                    });
                    setNotice(
                      "Feedback recorded. Only the Keep other plans fixed option will try this start hour later next time; other strategies retain their stated intent. Recompare to use it.",
                    );
                  }}
                >
                  That start time doesn’t work
                </button>
              </article>
            ))}
          </div>
          {!!result.proposals.length && (
            <label className="text-sm">
              Optional reason when rejecting a start time
              <input
                maxLength={140}
                className={field}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </label>
          )}
          {applied && (
            <section className={panel} aria-labelledby="applied-title">
              <h3 id="applied-title" className="forum-display text-2xl">
                Applied plan · {applied.title}
              </h3>
              <p className="text-sm">
                Only this visit’s working copy changed. Fixed events stay unchanged. The original source plan remains
                available through Undo.
              </p>
              <ul className="flex flex-col gap-2 text-sm">
                {plan.map((i) => (
                  <li key={i.id}>
                    {i.title}: {timestamp(i.start)} – {timestamp(i.end)}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button
                  className={buttonClass("quiet")}
                  onClick={() => {
                    setApplied(null);
                    setNotice("Undone. The source plan is restored; no feedback or completion records were deleted.");
                  }}
                >
                  Undo applied recovery
                </button>
                <button
                  className={buttonClass("quiet")}
                  onClick={() =>
                    download(recoveryCalendar(request, applied, new Date()), "text/calendar", "lens-recovery.ics")
                  }
                >
                  Export recovered sessions (.ics)
                </button>
              </div>
              <p className="text-xs text-ink-2">
                Export adds recovered sessions only. It cannot update an external calendar’s existing events. If another
                task moved, update that event yourself; check for duplicates before importing.
              </p>
              <form
                className="flex flex-col gap-3 border-t border-line pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (logged || alreadyRecorded || example) return;
                  if (!Number.isFinite(actual) || actual < 1 || actual > 1200) {
                    setError("Record 1–1200 actual minutes.");
                    return;
                  }
                  changeMemory({
                    ...memory,
                    history: [
                      ...memory.history,
                      {
                        id: completionId,
                        category,
                        estimated: result.estimate.base,
                        actual,
                        at: new Date().toISOString(),
                      },
                    ].slice(-100),
                  });
                  setLogged(true);
                  setNotice(
                    "Completion recorded from your report. No grade, stress, or effectiveness outcome was inferred.",
                  );
                }}
              >
                <h4 className="font-medium">After you finish all recovered work</h4>
                <label className="text-sm">
                  Total actual minutes across these sessions
                  <input
                    required
                    type="number"
                    min={1}
                    max={1200}
                    step={1}
                    className={field}
                    value={actual}
                    onChange={(e) => setActual(Number(e.target.value))}
                  />
                </label>
                <button disabled={logged || alreadyRecorded || example} className={buttonClass("quiet", "self-start")}>
                  {logged || alreadyRecorded
                    ? "Completion recorded"
                    : example
                      ? "Load your own week to record effort"
                      : "Record completed effort"}
                </button>
                <p className="text-xs text-ink-2">
                  Record the whole recovered task once, not each block. Completion is self-reported; being on the
                  calendar does not count as finished.
                </p>
              </form>
            </section>
          )}
        </section>
      )}

      <section className={panel} aria-labelledby="memory-title">
        <span className="forum-caps">04 · Memory you control</span>
        <h2 id="memory-title" className="forum-display text-3xl">
          Inspect, edit, or forget.
        </h2>
        <p className="text-sm text-ink-2">
          Work and replies stay in this browser tab. Memory is off by default and holds only category/time records and
          rejected start hours. Saving it uses this browser’s local storage, not your Lens account or the server. On a
          shared device, leave it off. Uploading a source through the separate reader uses its existing AI processing.
        </p>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => {
              try {
                if (e.target.checked) {
                  localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
                  setRemember(true);
                  setNotice("Memory saving enabled in this browser.");
                } else {
                  localStorage.removeItem(MEMORY_KEY);
                  setRemember(false);
                  setNotice("Saved browser memory deleted. This visit’s records remain until reset or close.");
                }
              } catch {
                setError("Browser memory storage is unavailable.");
              }
            }}
          />
          Remember these records in this browser
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClass("quiet")}
            onClick={() => {
              try {
                const raw = localStorage.getItem(MEMORY_KEY);
                if (!raw) throw new Error("No saved memory in this browser.");
                const m = Memory.parse(JSON.parse(raw));
                invalidate();
                setMemory(m);
                setRemember(true);
                setNotice("Saved memory loaded. Review it below before using it.");
              } catch (e) {
                setError(explainError(e));
              }
            }}
          >
            Load saved memory
          </button>
          <button
            className={buttonClass("quiet")}
            onClick={() => {
              try {
                localStorage.removeItem(MEMORY_KEY);
                sessionStorage.removeItem(WORKSPACE_KEY);
                setRemember(false);
                setMemory(emptyMemory());
                setPayload(null);
                setSelectedSource("");
                invalidate();
                setNotice(
                  "Memory and the waiting import were deleted. The current working week remains for this visit.",
                );
              } catch {
                setError("Could not clear saved memory. Check your browser settings.");
              }
            }}
          >
            Reset all memory
          </button>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={memory.preferDaytime}
            onChange={(e) => {
              invalidate();
              changeMemory({ ...memory, preferDaytime: e.target.checked });
            }}
          />
          Explicit preference: finish work before 9 PM
        </label>
        <p className="text-sm">
          {memory.history.length} completion records · {memory.rejected.length} rejected start times
        </p>
        {memory.history.map((h) => (
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm"
            key={h.id}
          >
            <span>
              {h.category}: estimated {h.estimated} min, actual {h.actual} min · {new Date(h.at).toLocaleDateString()}
            </span>
            <button
              className={buttonClass("plain")}
              onClick={() => {
                invalidate();
                changeMemory({ ...memory, history: memory.history.filter((x) => x.id !== h.id) });
              }}
            >
              Delete completion record
            </button>
          </div>
        ))}
        {memory.rejected.map((r) => (
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm"
            key={r.id}
          >
            <span>
              {r.hour}:00 start · {r.reason}
            </span>
            <button
              className={buttonClass("plain")}
              onClick={() => {
                invalidate();
                changeMemory({ ...memory, rejected: memory.rejected.filter((x) => x.id !== r.id) });
              }}
            >
              Delete rejected time
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
