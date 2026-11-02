"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DemoReply } from "@/app/api/rebuild/demo/route";
import REBUILDS from "@/lib/demo/rebuilds.json";
import type { Step } from "@/lib/rebuild/agent";
import { RebuildRequest, type RebuildResponse } from "@/lib/rebuild/contract";
import { Draft } from "@/lib/rebuild/draft";
import { DayTimeline } from "./rebuild/DayTimeline";
import { Thread, type Msg, type MsgState } from "./rebuild/Thread";
import { Checks, Trace } from "./rebuild/Trace";
import { buildWeek, span, type Pastel } from "./rebuild/week";
import { WeekGrid, type Phase } from "./rebuild/WeekGrid";

// The flagship, in one click: a made-up week, a session that passes undone,
// Tomorrow's check-in and the reply, Lens's agent finding time (its tool calls
// streaming in), the session gliding to its new slot, and the one recovery
// text. The click runs Muse Spark live (the same case and reply again comes
// from Lens's cache, free); when a live run isn't possible the recorded run
// (the one `pnpm eval:rebuild` scores) plays instead, and says so.

type Run = {
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
type Status = "idle" | "running" | "done";

const WHY: Record<string, string> = {
  OutOfTime: "the model took too long",
  TooManyTurns: "the model didn't finish in 8 turns",
  CheckFailed: "the model's plan didn't pass code's check",
};

const noop = () => () => {};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HIDDEN: MsgState[] = ["hidden", "hidden", "hidden"];

function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const q = window.matchMedia("(prefers-reduced-motion: reduce)");
      q.addEventListener("change", cb);
      return () => q.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

export function MissDemo() {
  // Luxon reads the clock while parsing, which Cache Components refuses during
  // prerender, so the week renders on the client only (the header is static).
  const inBrowser = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const reduced = useReducedMotion();
  const [name, setName] = useState(REBUILDS[0].name);
  const demo = REBUILDS.find((r) => r.name === name) ?? REBUILDS[0];
  const request = useMemo(() => RebuildRequest.parse(demo.request), [demo]);
  const [reply, setReply] = useState(demo.request.missed.reply ?? "");
  const [run, setRun] = useState<Run | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [phase, setPhase] = useState<Phase>("before");
  const [view, setView] = useState<"before" | "after">("before");
  const [bands, setBands] = useState(false);
  const [msgs, setMsgs] = useState<MsgState[]>(HIDDEN);
  const [stepsShown, setStepsShown] = useState(0);
  const [badge, setBadge] = useState(false);
  const [counter, setCounter] = useState<{ changed: number; unchanged: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const playing = useRef(0);
  const landed = useRef<(() => void) | null>(null);
  useEffect(() => () => void (playing.current += 1), []);

  const recorded = (r: string | null): Run => ({
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

  const reset = () => {
    playing.current += 1;
    setRun(null);
    setStatus("idle");
    setPhase("before");
    setView("before");
    setBands(false);
    setMsgs(HIDDEN);
    setStepsShown(0);
    setBadge(false);
    setCounter(null);
    setNote(null);
  };
  const pick = (n: string) => {
    setName(n);
    setReply(REBUILDS.find((r) => r.name === n)!.request.missed.reply ?? "");
    reset();
  };

  async function fetchRun(typed: string | null): Promise<Run | string> {
    try {
      const res = await fetch("/api/rebuild/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case: name, reply: typed }),
      });
      const body = await res.json();
      if (!res.ok) return body.error ?? "The live run didn't work.";
      const r = body as DemoReply;
      return { ...r, steps: r.steps as Step[], reply: typed, live: true };
    } catch {
      return "The live run didn't work.";
    }
  }

  function tick(final: { changed: number; unchanged: number }) {
    if (reduced) return setCounter(final);
    const frames = 8;
    for (let i = 1; i <= frames; i++)
      setTimeout(() => setCounter({ changed: Math.round((final.changed * i) / frames), unchanged: Math.round((final.unchanged * i) / frames) }), i * 50); // prettier-ignore
  }

  async function play() {
    reset();
    const me = playing.current;
    const still = () => playing.current === me;
    const typed = reply.trim() || null;
    setStatus("running");
    setView("after");
    const pending = fetchRun(typed);
    const settle = async (): Promise<Run | null> => {
      const r = await pending;
      if (typeof r !== "string") return r;
      // The recording is for this case's own reply; a typed one can only be run live.
      if (typed !== (demo.request.missed.reply ?? null)) {
        if (still()) {
          reset();
          setNote(`${r} Try again later, or play a week with its own reply.`);
        }
        return null;
      }
      setNote(`Showing the recorded run. ${r}`);
      return recorded(typed);
    };

    if (reduced) {
      const r = await settle();
      if (!r || !still()) return;
      const m = buildWeek({ ...request, missed: { ...request.missed, reply: r.reply } }, r.response);
      setRun(r);
      setPhase("after");
      setMsgs(["shown", "shown", "shown"]);
      setStepsShown(r.steps.length);
      setCounter({ changed: m.counts.changed, unchanged: m.counts.unchanged });
      setStatus("done");
      return;
    }

    await wait(250);
    if (!still()) return;
    setPhase("missed");
    await wait(700);
    if (!still()) return;
    setMsgs(["typing", "hidden", "hidden"]);
    await wait(900);
    if (!still()) return;
    setMsgs(["shown", "hidden", "hidden"]);
    await wait(800);
    if (!still()) return;
    setMsgs(["shown", "shown", "hidden"]);
    const r = await settle();
    if (!r || !still()) return;
    const m = buildWeek({ ...request, missed: { ...request.missed, reply: r.reply } }, r.response);
    setRun(r);
    setBands(true);
    for (let n = 1; n <= r.steps.length; n++) {
      await wait(420);
      if (!still()) return;
      setStepsShown(n);
    }
    await wait(300);
    if (!still()) return;
    setBands(false);
    setPhase("moving");
    await new Promise<void>((done) => {
      landed.current = done;
      setTimeout(done, 1600);
    });
    if (!still()) return;
    setPhase("after");
    setBadge(true);
    tick({ changed: m.counts.changed, unchanged: m.counts.unchanged });
    setTimeout(() => still() && setBadge(false), 2600);
    await wait(500);
    if (!still()) return;
    setMsgs(["shown", "shown", "typing"]);
    await wait(1000);
    if (!still()) return;
    setMsgs(["shown", "shown", "shown"]);
    setStatus("done");
  }

  if (!inBrowser) return <Frame placeholder>{null}</Frame>;

  const shown = run ?? recorded(reply.trim() || null);
  const req: RebuildRequest = { ...request, missed: { ...request.missed, reply: shown.reply } };
  const model = buildWeek(req, shown.response);
  const d = new Draft(req);
  const missed = d.missed;
  const color: Pastel = model.colorOf(missed.course) ?? "powder";
  const stamp = (ms: number) => d.local(ms).toFormat("ccc h:mm a");
  const messages: Msg[] = [
    { from: "tomorrow", text: `Tomorrow: Did ${missed.title} happen?`, stamp: stamp(Date.parse(missed.end) + 15 * 60_000) }, // prettier-ignore
    shown.reply
      ? { from: "you", text: shown.reply, stamp: stamp(d.now) }
      : { from: "note", text: "No reply in 2 hours", stamp: stamp(d.now) },
    { from: "tomorrow", text: `Tomorrow: ${shown.response.message}`, stamp: null, mark: { word: missed.title, color } },
  ];
  const gridPhase: Phase = status === "done" ? (view === "after" ? "after" : "before") : phase;
  const source = shown.live ? (shown.cached ? "live, from cache" : "live") : "recorded";
  const changes = shown.response.diff.filter((x) => x.action !== "keep");
  const when = (start: string, end: string) =>
    `${d.local(Date.parse(start)).toFormat("ccc")} ${span(Date.parse(start), Date.parse(end), d.zone)}`;

  return (
    <Frame>
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={play}
          disabled={status === "running"}
          className="min-h-11 min-w-[14rem] rounded-lg px-5 text-sm font-medium disabled:opacity-60"
          style={{ background: "var(--tm-crimson-fill)", color: "var(--tm-on-crimson)" }}
        >
          {status === "running" ? "Rebuilding…" : status === "done" ? "Play again" : `Play: miss ${missed.title}`}
        </button>
        <div
          role="radiogroup"
          aria-label="Show the week"
          className="flex rounded-lg p-1"
          style={{ border: "1px solid var(--tm-border-strong)" }}
        >
          {(["before", "after"] as const).map((v) => {
            const on = status === "done" ? view === v : v === "before";
            return (
              <button
                key={v}
                role="radio"
                aria-checked={on}
                disabled={status !== "done"}
                onClick={() => setView(v)}
                className="min-h-9 rounded-md px-3 text-sm capitalize disabled:opacity-50"
                style={on ? { background: "var(--tm-text)", color: "var(--tm-bg)" } : { color: "var(--tm-text-2)" }}
              >
                {v}
              </button>
            );
          })}
        </div>
        <span
          className={`forum-in text-sm ${counter ? "" : "forum-hidden"}`}
          style={{ color: "var(--tm-text-2)", minWidth: "20ch" }}
          aria-live="polite"
        >
          changed <span style={{ color: "var(--tm-text)" }}>{counter?.changed ?? 0}</span> · unchanged{" "}
          <span style={{ color: "var(--tm-text)" }}>{counter?.unchanged ?? 0}</span>
        </span>
      </div>
      <p className="-mt-2 text-sm" style={{ color: "var(--tm-text-2)" }}>
        {demo.about}
      </p>

      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <div className="hidden md:block">
            <WeekGrid
              model={model}
              phase={gridPhase}
              missedId={missed.id}
              showBands={bands}
              badge={badge}
              reduced={reduced}
              onMoved={() => landed.current?.()}
            />
          </div>
          <div className="md:hidden">
            <DayTimeline model={model} phase={gridPhase} missedId={missed.id} />
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <Thread
            messages={messages}
            states={msgs}
            hint={
              status === "idle"
                ? `${missed.title} is planned for ${when(missed.start, missed.end)}. Press Play to miss it.`
                : null
            }
          />
          <div
            className={`forum-in flex-col gap-3 ${status === "idle" ? "hidden" : "flex"} ${status === "done" ? "" : "forum-hidden"}`}
            aria-hidden={status !== "done"}
          >
            <h3 className="text-sm font-medium">What changed</h3>
            <ul className="flex flex-col gap-3">
              {changes.map((x) => {
                const i = d.item(x.item_id)!;
                return (
                  <li
                    key={x.item_id}
                    className="flex flex-col gap-1 rounded-xl p-4 text-sm"
                    style={{ background: "var(--tm-surface)", border: "1px solid var(--tm-border)" }}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <span
                        aria-hidden
                        className="h-3 w-3 rounded"
                        style={{ background: `var(--tm-${model.colorOf(i.course) ?? "powder"})`, border: "1px solid var(--tm-border-strong)" }} // prettier-ignore
                      />
                      {i.title}
                    </span>
                    <span>
                      <s style={{ color: "var(--tm-muted)" }}>{when(i.start, i.end)}</s> →{" "}
                      {x.start && x.end ? when(x.start, x.end) : "dropped"}
                    </span>
                    {x.reason && <span style={{ color: "var(--tm-text-2)" }}>Because {x.reason}.</span>}
                  </li>
                );
              })}
            </ul>
            <Checks checks={model.checks} shown={status === "done"} />
            {shown.fell_back && (
              <p className="text-sm" style={{ color: "var(--tm-crimson)" }}>
                Muse Spark wasn&apos;t used: {WHY[shown.fell_back] ?? "the model couldn't be reached"}. Code placed it
                in the first free time before its deadline instead.
              </p>
            )}
          </div>
        </div>
      </div>

      {note && (
        <p className="text-sm" style={{ color: "var(--tm-crimson)" }}>
          {note}
        </p>
      )}

      <Trace
        steps={run?.steps ?? []}
        shown={stepsShown}
        d={d}
        cost={shown.cost_usd}
        seconds={shown.latency_s}
        source={source}
        thinking={status === "running"}
        reserve={status !== "idle"}
      />

      <div className="flex flex-col gap-4 rounded-xl p-4" style={{ background: "var(--tm-sunken)" }}>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="miss-reply">
            Your reply to &quot;Did {missed.title} happen?&quot;
          </label>
          <input
            id="miss-reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={280}
            placeholder="Leave it empty for no reply"
            className="min-h-11 rounded-lg px-3 text-sm"
            style={{ background: "var(--tm-surface)", border: "1px solid var(--tm-border-strong)", color: "var(--tm-text)" }} // prettier-ignore
          />
          <p className="text-xs" style={{ color: "var(--tm-text-2)" }}>
            Change it and press Play to run Muse Spark on your reply: about a cent, a few runs per visitor, within
            Lens&apos;s daily spending limit. Try &quot;practice ran late, home by 10&quot;.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Other weeks</span>
          <div role="tablist" aria-label="Weeks" className="flex flex-wrap gap-2">
            {REBUILDS.map((r) => (
              <button
                key={r.name}
                role="tab"
                aria-selected={r.name === name}
                onClick={() => pick(r.name)}
                className="min-h-9 rounded-lg px-3 text-sm"
                style={r.name === name ? { background: "var(--tm-text)", color: "var(--tm-bg)" } : { border: "1px solid var(--tm-border-strong)", color: "var(--tm-text-2)" }} // prettier-ignore
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

function Frame({ children, placeholder = false }: { children: React.ReactNode; placeholder?: boolean }) {
  return (
    <section id="missed-session" aria-label="Try a missed session" className="scroll-mt-6">
      <div
        // Before the week renders (client only), hold its height so the page below doesn't jump when it appears.
        className={`forum flex flex-col gap-6 rounded-2xl p-4 sm:p-8 ${placeholder ? "min-h-[2160px] md:min-h-[1648px] lg:min-h-[1524px]" : ""}`}
        style={{ border: "1px solid var(--tm-border)" }}
      >
        <header className="flex flex-col gap-2">
          <span className="forum-caps">III · Rebuild</span>
          <h2 className="forum-display text-3xl sm:text-4xl">Miss a session. Lens rebuilds the week.</h2>
          <p className="max-w-2xl text-base" style={{ color: "var(--tm-text-2)" }}>
            When a planned session passes undone, Tomorrow asks once. Lens decides what moves and why, code checks every
            move against the free time, and Tomorrow sends one text.
          </p>
        </header>
        {children}
      </div>
    </section>
  );
}
