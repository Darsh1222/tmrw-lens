"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DemoReply } from "@/app/api/rebuild/demo/route";
import REBUILDS from "@/lib/demo/rebuilds.json";
import type { Step } from "@/lib/rebuild/agent";
import { RebuildRequest, type RebuildResponse } from "@/lib/rebuild/contract";
import { checkResponse, Draft } from "@/lib/rebuild/draft";
import { money } from "./ui";

// The flagship, try-able without Tomorrow, in one click: a made-up week, a
// session that passes undone, the check-in and reply, the rebuild agent's tool
// calls one by one, and the result: what changed and why, and the one recovery
// text. The click runs Muse Spark live (the same case and reply again comes
// from Lens's cache, so it's free); if a live run isn't possible right now, the
// recorded run (the one `pnpm eval:rebuild` scores) plays instead, and says so.

type Shown = {
  response: RebuildResponse;
  steps: Step[];
  turns: number;
  cost_usd: number;
  latency_s: number;
  fell_back: string | null;
  reply: string | null;
  live: boolean;
  cached: boolean;
};

const WHY: Record<string, string> = {
  SpendCapReached: "Lens has reached today's spending limit for model calls",
  OutOfTime: "the model took too long",
  TooManyTurns: "the model didn't finish in 8 turns",
  CheckFailed: "the model's plan didn't pass code's check",
};

function describeStep(s: Step, d: Draft): { call: string; said: string } {
  const a = (s.args && typeof s.args === "object" ? s.args : {}) as Record<string, unknown>;
  const r = s.result;
  const at = (v: unknown) => {
    const ms = typeof v === "string" ? d.parseLocal(v) : NaN;
    return typeof ms === "number" && Number.isFinite(ms) ? d.local(ms).toFormat("ccc HH:mm") : String(v);
  };
  const title = (id: unknown) => d.item(String(id))?.title ?? String(id);
  if (!s.ok) return { call: callText(), said: `refused: ${String(r.problem)}` };
  return { call: callText(), said: saidText() };

  function callText() {
    switch (s.tool) {
      case "get_day":
        return `get_day(${String(a.date)})`;
      case "find_open_time":
        return `find_open_time(${String(a.minutes)} min${a.after && a.after !== "null" ? `, after ${at(a.after)}` : ""}${a.before && a.before !== "null" ? `, before ${at(a.before)}` : ""})`; // prettier-ignore
      case "move_item":
        return `move_item(${title(a.item_id)}, ${at(a.start)}${a.duration_min && a.duration_min !== "null" ? `, ${String(a.duration_min)} min` : ""})`;
      case "drop_item":
        return `drop_item(${title(a.item_id)})`;
      case "undo_change":
        return `undo_change(${title(a.item_id)})`;
      default:
        return `${s.tool}()`;
    }
  }
  function saidText() {
    switch (s.tool) {
      case "get_day":
        return `free ${(r.free as string[]).join(", ") || "none"}`;
      case "find_open_time": {
        const free = r.free as { start: string; end: string }[];
        if (free.length) return `free ${free.map((f) => `${at(f.start)}-${f.end.slice(11)}`).join(", ")}`;
        const there = (r.planned_in_range as { title: string }[] | undefined)?.map((p) => p.title);
        return `nothing free${there?.length ? `; planned there: ${there.join(", ")}` : ""}`;
      }
      case "move_item":
        return `moved to ${String(r.to)}`;
      case "drop_item":
        return "dropped";
      case "undo_change":
        return "put back";
      default:
        return "done";
    }
  }
}

const noop = () => () => {};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** idle: the week; missed: the check-in and reply; thinking: tool calls appearing; done: the result. */
type Stage = "idle" | "missed" | "thinking" | "done";

export function MissDemo() {
  // Luxon reads the clock while parsing, which Cache Components refuses during
  // prerender, so the cases render on the client only (the header is static).
  const inBrowser = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const [name, setName] = useState(REBUILDS[0].name);
  const demo = REBUILDS.find((r) => r.name === name) ?? REBUILDS[0];
  const request = useMemo(() => RebuildRequest.parse(demo.request), [demo]);
  const [reply, setReply] = useState(demo.request.missed.reply ?? "");
  const [stage, setStage] = useState<Stage>("idle");
  const [run, setRun] = useState<Shown | null>(null);
  const [shownSteps, setShownSteps] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const playing = useRef(0);
  useEffect(() => () => void (playing.current += 1), []);

  const recorded = (r: string | null): Shown => ({
    response: demo.response as RebuildResponse,
    steps: demo.steps as Step[],
    turns: demo.turns,
    cost_usd: demo.cost_usd,
    latency_s: demo.latency_s,
    fell_back: null,
    reply: r,
    live: false,
    cached: false,
  });

  const pick = (n: string) => {
    const next = REBUILDS.find((r) => r.name === n)!;
    playing.current += 1;
    setName(n);
    setReply(next.request.missed.reply ?? "");
    setStage("idle");
    setRun(null);
    setNote(null);
  };

  async function play() {
    const me = ++playing.current;
    const typed = reply.trim() || null;
    const still = () => playing.current === me;
    setRun(null);
    setNote(null);
    setShownSteps(0);
    setStage("missed");
    const started = Date.now();
    let result: Shown;
    try {
      const res = await fetch("/api/rebuild/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case: name, reply: typed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The live run didn't work.");
      const r = body as DemoReply;
      result = { ...r, steps: r.steps as Step[], reply: typed, live: true };
    } catch (e) {
      // The recorded run is for this case's own reply; a typed one can only be shown live.
      if (typed !== (demo.request.missed.reply ?? null)) {
        if (still()) {
          setStage("idle");
          setNote(`${e instanceof Error ? e.message : "The live run didn't work."} Try again later, or play a case with its own reply.`); // prettier-ignore
        }
        return;
      }
      result = recorded(typed);
      setNote(`Showing the recorded run. ${e instanceof Error ? e.message : "The live run didn't work."}`);
    }
    // Let the check-in and reply land before the agent starts, however fast the answer came.
    await wait(Math.max(0, 1200 - (Date.now() - started)));
    if (!still()) return;
    setRun(result);
    setStage("thinking");
    for (let n = 1; n <= result.steps.length; n++) {
      await wait(450);
      if (!still()) return;
      setShownSteps(n);
    }
    await wait(450);
    if (still()) setStage("done");
  }

  if (!inBrowser) return <Frame>{null}</Frame>;

  const shown = run ?? recorded(reply.trim() || null);
  const req: RebuildRequest = { ...request, missed: { ...request.missed, reply: shown.reply } };
  const d = new Draft(req);
  const missed = d.missed;
  const problems = checkResponse(req, shown.response);
  const checkInAt = Date.parse(missed.end) + 15 * 60_000;
  const stamp = (ms: number) => d.local(ms).toFormat("ccc h:mma").replace("AM", "am").replace("PM", "pm");
  const after = stage !== "idle";
  const changed = shown.response.diff.filter((x) => x.action !== "keep").length;
  const week = [
    ...req.items.map((i) => ({ at: Date.parse(i.start), end: Date.parse(i.end), what: i.title, kind: i.id === missed.id ? "missed" : "planned", course: i.course })), // prettier-ignore
    ...req.fixed.map((f) => ({ at: Date.parse(f.start), end: Date.parse(f.end), what: f.title, kind: "busy", course: null })), // prettier-ignore
    ...req.deadlines.map((x) => ({ at: Date.parse(x.due), end: null, what: x.title, kind: "due", course: x.course })),
  ].sort((a, b) => a.at - b.at);

  return (
    <Frame>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={play}
          disabled={stage === "missed" || stage === "thinking"}
          className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {stage === "missed" || stage === "thinking"
            ? "Rebuilding…"
            : stage === "done"
              ? "Run it again"
              : `Miss "${missed.title}" and rebuild`}{" "}
          {/* prettier-ignore */}
        </button>
        <span className="text-sm text-text-secondary">{demo.about}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">The week (made up)</h3>
          <ol className="flex flex-col gap-1 text-sm">
            {week.map((w, n) => (
              <li
                key={n}
                className={`flex flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1 ${w.kind === "missed" && after ? "bg-unverified/10" : w.kind === "busy" ? "text-text-secondary" : ""}`}
              >
                <span className="w-32 shrink-0 tabular-nums text-text-secondary">
                  {w.end === null
                    ? `${d.day(w.at).slice(0, 3)} ${d.hhmm(w.at)}`
                    : `${d.day(w.at).slice(0, 3)} ${d.hhmm(w.at)}-${d.hhmm(w.end)}`}{" "}
                  {/* prettier-ignore */}
                </span>
                <span className={w.kind === "missed" && after ? "line-through" : ""}>
                  {w.kind === "due" ? `${w.what} due` : w.what}
                </span>
                {w.kind === "missed" && after && <span className="text-xs font-medium text-unverified">missed</span>}
                {w.kind === "busy" && <span className="text-xs">class</span>}
              </li>
            ))}
          </ol>
          <p className="text-xs text-text-secondary">
            It&apos;s {stamp(d.now)}. Tomorrow sent Lens this week and its free time.
          </p>
        </div>

        <div className="flex flex-col gap-2" aria-label="Messages" aria-live="polite">
          <h3 className="text-sm font-medium">The texts</h3>
          {after ? (
            <>
              <div className="max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-surface px-3 py-2 text-sm">
                <span className="block text-xs text-text-secondary">Tomorrow · {stamp(checkInAt)}</span>
                Did {missed.title} happen?
              </div>
              {shown.reply ? (
                <div className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-white">
                  {shown.reply}
                </div>
              ) : (
                <p className="self-end text-sm italic text-text-secondary">No reply in 2 hours</p>
              )}
              {stage === "done" ? (
                <div className="max-w-[85%] self-start rounded-2xl rounded-bl-sm border border-verified/40 bg-verified/5 px-3 py-2 text-sm">
                  <span className="block text-xs text-text-secondary">Tomorrow · {stamp(d.now)}</span>
                  {shown.response.message}
                </div>
              ) : (
                <p className="self-start text-sm text-text-secondary">Lens is rebuilding…</p>
              )}
            </>
          ) : (
            <p className="text-sm text-text-secondary">
              Press the button: {missed.title} passes undone, Tomorrow checks in, and Lens rebuilds the rest of the
              week.
            </p>
          )}
        </div>
      </div>

      {(stage === "thinking" || stage === "done") && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">
            Muse Spark, with tools{" "}
            <span className="font-normal text-text-secondary">
              ·{" "}
              {shown.live
                ? shown.cached
                  ? "live result, from Lens's cache (this reply was run before)"
                  : `live, just now · ${money(shown.cost_usd)} · ${shown.latency_s.toFixed(1)}s`
                : "recorded run"}
            </span>
          </h3>
          <ol className="flex flex-col gap-1 font-mono text-xs">
            {shown.steps.slice(0, shownSteps).map((s, n) => {
              const { call, said } = describeStep(s, d);
              return (
                <li key={n} className="break-words">
                  {call} <span className="text-text-secondary">→</span>{" "}
                  <span className={s.ok ? "text-text-secondary" : "text-unverified"}>{said}</span>
                </li>
              );
            })}
          </ol>
          {shown.fell_back && (
            <p className="text-xs text-unverified">
              Muse Spark wasn&apos;t used: {WHY[shown.fell_back] ?? "the model couldn't be reached"}. Code placed it in
              the first free time before its deadline instead.
            </p>
          )}
        </div>
      )}

      {stage === "done" && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            What changed{" "}
            <span className="font-normal text-text-secondary">
              · changed {changed}, unchanged {shown.response.diff.length - changed}
            </span>
          </h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {req.items.map((i) => {
              const x = shown.response.diff.find((e) => e.item_id === i.id);
              const was = `${i.status === "missed" ? "missed, was " : ""}${d.at({ s: Date.parse(i.start), e: Date.parse(i.end) })}`; // prettier-ignore
              return (
                <li key={i.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium">{i.title}</span>
                    {i.course && <span className="text-xs text-text-secondary">{i.course}</span>}
                  </div>
                  {!x || x.action === "keep" ? (
                    <div className="text-text-secondary">{was} · unchanged</div>
                  ) : (
                    <div>
                      <s className="text-text-secondary">{was}</s> →{" "}
                      {x.action === "move" ? (
                        <span className="font-medium text-verified">
                          {d.at({ s: Date.parse(x.start!), e: Date.parse(x.end!) })}
                        </span>
                      ) : (
                        <span className="font-medium text-unverified">dropped</span>
                      )}
                      {x.reason && <p className="text-xs text-text-secondary">because {x.reason}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className={`text-xs ${problems.length ? "text-unverified" : "text-verified"}`}>
            {problems.length
              ? `Code's check found: ${problems.join("; ")}`
              : "✓ Checked by code: every move is after now, inside free time, overlaps nothing, and ends before its deadline; the text says exactly what changed."}
          </p>
        </div>
      )}
      {note && <p className="text-xs text-unverified">{note}</p>}

      <div className="flex flex-col gap-3 rounded-lg bg-surface p-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="miss-reply">
            Their reply to &quot;Did {missed.title} happen?&quot;
          </label>
          <input
            id="miss-reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={280}
            placeholder="Leave it empty for no reply"
            className="min-w-0 rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
          />
          <p className="text-xs text-text-secondary">
            Change it and press the button to run Muse Spark on your reply (about a cent, a few runs per visitor, within
            Lens&apos;s daily spending limit). Try &quot;practice ran late, home by 10&quot;.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Other weeks</span>
          <div role="tablist" aria-label="Cases" className="flex flex-wrap gap-1.5">
            {REBUILDS.map((r) => (
              <button
                key={r.name}
                role="tab"
                aria-selected={r.name === name}
                onClick={() => pick(r.name)}
                className={`rounded-full border px-3 py-1 text-sm ${r.name === name ? "border-accent bg-accent/10 text-text" : "border-border text-text-secondary hover:text-text"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section id="missed-session" aria-label="Try a missed session" className="mx-auto w-full max-w-6xl px-4 pb-10">
      <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Try a missed session</h2>
          <p className="max-w-3xl text-sm text-text-secondary">
            When a planned session passes undone, Tomorrow asks once. Whatever the answer, Lens rebuilds what&apos;s
            left with Muse Spark: what moves, what drops, and why. Code checks every move against the free time, and
            Tomorrow sends one text.
          </p>
        </header>
        {children}
      </div>
    </section>
  );
}
