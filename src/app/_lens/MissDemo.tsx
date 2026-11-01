"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { DemoReply } from "@/app/api/rebuild/demo/route";
import REBUILDS from "@/lib/demo/rebuilds.json";
import type { Step } from "@/lib/rebuild/agent";
import { RebuildRequest, type RebuildResponse } from "@/lib/rebuild/contract";
import { checkResponse, Draft } from "@/lib/rebuild/draft";
import { money } from "./ui";

// The flagship, try-able without Tomorrow: a made-up week where a planned
// session passed undone. Each case replays the agent's recorded run for free
// (the same runs `pnpm eval:rebuild` scores); "Rebuild it live" runs Muse Spark
// now with whatever reply the visitor types.

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
  const [live, setLive] = useState<Shown | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (n: string) => {
    const next = REBUILDS.find((r) => r.name === n)!;
    setName(n);
    setReply(next.request.missed.reply ?? "");
    setLive(null);
    setError(null);
  };

  if (!inBrowser) return <Frame>{null}</Frame>;

  const shown: Shown = live ?? {
    response: demo.response as RebuildResponse,
    steps: demo.steps as Step[],
    turns: demo.turns,
    cost_usd: demo.cost_usd,
    latency_s: demo.latency_s,
    fell_back: null,
    reply: request.missed.reply,
    live: false,
    cached: false,
  };
  const req: RebuildRequest = { ...request, missed: { ...request.missed, reply: shown.reply } };
  const d = new Draft(req);
  const missed = d.missed;
  const problems = checkResponse(req, shown.response);
  const checkInAt = Date.parse(missed.end) + 15 * 60_000;
  const stamp = (ms: number) => d.local(ms).toFormat("ccc h:mma").replace("AM", "am").replace("PM", "pm");

  async function runLive() {
    setRunning(true);
    setError(null);
    const typed = reply.trim() || null;
    try {
      const res = await fetch("/api/rebuild/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case: name, reply: typed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong. The recorded run is still shown.");
      const r = body as DemoReply;
      setLive({ ...r, steps: r.steps as Step[], reply: typed, live: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. The recorded run is still shown.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Frame>
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
      <p className="text-sm text-text-secondary">
        {demo.about}{" "}
        <span className="text-xs">
          {shown.live
            ? shown.cached
              ? "Live result (this reply was run before, so it came from the cache)."
              : "Live, just now."
            : "Recorded from Muse Spark, so replaying it is free."}
        </span>
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2" aria-label="Messages">
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
          <div className="max-w-[85%] self-start rounded-2xl rounded-bl-sm border border-verified/40 bg-verified/5 px-3 py-2 text-sm">
            <span className="block text-xs text-text-secondary">Tomorrow · {stamp(d.now)}</span>
            {shown.response.message}
          </div>
          {shown.fell_back && (
            <p className="text-xs text-unverified">
              Muse Spark wasn&apos;t used: {WHY[shown.fell_back] ?? "the model couldn't be reached"}. Code placed it in
              the first free time before its deadline instead.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">What changed</h3>
          <ul className="flex flex-col gap-1.5">
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
          {req.deadlines.length > 0 && (
            <p className="text-xs text-text-secondary">
              Deadlines:{" "}
              {req.deadlines.map((x) => `${x.title} ${d.local(Date.parse(x.due)).toFormat("ccc HH:mm")}`).join(" · ")}
            </p>
          )}
          <p className={`text-xs ${problems.length ? "text-unverified" : "text-verified"}`}>
            {problems.length
              ? `Code's check found: ${problems.join("; ")}`
              : "✓ Checked by code: every move is after now, inside free time, overlaps nothing, and ends before its deadline; the message says exactly what changed."}
          </p>
        </div>
      </div>

      {shown.steps.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-text-secondary">
            How Muse Spark decided: {shown.steps.length} tool calls in {shown.turns} turns · {money(shown.cost_usd)} ·{" "}
            {shown.latency_s.toFixed(1)}s
          </summary>
          <ol className="mt-2 flex flex-col gap-1 font-mono text-xs">
            {shown.steps.map((s, n) => {
              const { call, said } = describeStep(s, d);
              return (
                <li key={n} className="break-words">
                  {call} <span className="text-text-secondary">→</span>{" "}
                  <span className={s.ok ? "text-text-secondary" : "text-unverified"}>{said}</span>
                </li>
              );
            })}
          </ol>
        </details>
      )}

      <div className="flex flex-col gap-2 rounded-lg bg-surface p-3">
        <label className="text-sm font-medium" htmlFor="miss-reply">
          Your reply to &quot;Did {missed.title} happen?&quot;
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="miss-reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={280}
            placeholder="Leave it empty for no reply"
            className="min-w-0 flex-1 basis-56 rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
          />
          <button
            onClick={runLive}
            disabled={running}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {running ? "Rebuilding…" : "Rebuild it live"}
          </button>
        </div>
        <p className="text-xs text-text-secondary">
          Runs Muse Spark now on this made-up week with your reply, for about a cent and 5 seconds. A few runs per
          visitor, within Lens&apos;s daily spending limit. Try &quot;practice ran late, home by 10&quot;.
        </p>
        {error && <p className="text-xs text-unverified">{error}</p>}
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
            Tomorrow sends one message.
          </p>
        </header>
        {children}
      </div>
    </section>
  );
}
