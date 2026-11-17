"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { WORKSPACE_KEY } from "@/lib/recovery/workspace";
import type { Plan, SourceMeta } from "@/lib/plan/types";
import { toIcs } from "@/lib/calendar/ics";
import { NotSendable, sendable, toImport, type ImportResponse } from "@/lib/tomorrow/contract";
import { buttonClass } from "./ui";

// Send to Tomorrow: only verified items go. Everything else waits, and says so.
// The Lens token comes from Tomorrow's Settings. After the first send Tomorrow
// accepts, it's remembered in this browser only (never sent anywhere but
// Tomorrow, via /api/send), until "Forget token" or Tomorrow refuses it.

const KEY = "lens_tomorrow_token";
const listeners = new Set<() => void>();
const saved = {
  read: (): string | null => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write: (token: string | null) => {
    try {
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
    } catch {
      // Private window or blocked storage: it just isn't remembered.
    }
    listeners.forEach((f) => f());
  },
  subscribe: (f: () => void) => {
    listeners.add(f);
    return () => listeners.delete(f);
  },
};

export function SendPanel({ plan, sources }: { plan: Plan; sources: SourceMeta[] }) {
  const router = useRouter();
  const remembered = useSyncExternalStore(saved.subscribe, saved.read, () => null);
  const [typed, setToken] = useState("");
  const token = remembered ?? typed;
  const [state, setState] = useState<
    { s: "idle" } | { s: "sending" } | { s: "sent"; r: ImportResponse } | { s: "error"; message: string }
  >({ s: "idle" });
  const { classes, items, waiting } = sendable(plan);
  const count = classes.length + items.length;

  const build = () => {
    try {
      return toImport(plan, sources);
    } catch (e) {
      setState({ s: "error", message: e instanceof NotSendable ? `Not sent: ${e.message}.` : "Nothing to send yet." });
      return null;
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = build();
    if (!payload) return;
    setState({ s: "sending" });
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim(), import: payload }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    // A token Tomorrow refuses is forgotten, so the box comes back for a new one.
    if (res?.status === 401) saved.write(null);
    if (!res?.ok) setState({ s: "error", message: body?.error ?? "Couldn't send. Try again." });
    else {
      saved.write(token.trim());
      setState({ s: "sent", r: body as ImportResponse });
    }
  };

  const save = (body: string, type: string, name: string) => {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  };
  const download = () => {
    const payload = build();
    if (payload) save(JSON.stringify(payload, null, 2), "application/json", "lens-import.json");
  };
  // The same verified items, for any calendar app: a file, nothing sent anywhere.
  const calendar = () => {
    try {
      save(toIcs(plan, sources, new Date()), "text/calendar", "lens-plan.ics");
    } catch (e) {
      setState({ s: "error", message: e instanceof NotSendable ? `Not saved: ${e.message}.` : "Nothing to add yet." });
    }
  };

  const makePlan = () => {
    const payload = build();
    if (!payload) return;
    try {
      sessionStorage.setItem(WORKSPACE_KEY, JSON.stringify(payload));
      if (window.location.pathname === "/") window.dispatchEvent(new Event("lens:import-ready"));
      else router.push("/?tab=week");
    } catch {
      setState({ s: "error", message: "This browser could not prepare your plan." });
    }
  };
  return (
    <section aria-labelledby="send-title" className="source-next-step">
      <div>
        <span className="workspace-eyebrow">From dates to doing</span>
        <h2 id="send-title" className="forum-display text-3xl">
          Ready to make room for the work?
        </h2>
        <p>
          {count} confirmed items{waiting ? ` · ${waiting} still need a look` : ""}. Only confirmed dates go into your
          plan.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button disabled={!count} className={buttonClass("primary", "rounded-full")} onClick={makePlan}>
          Make a study plan
        </button>
        <button disabled={!count} className={buttonClass("quiet", "rounded-full")} onClick={calendar}>
          Export confirmed dates
        </button>
      </div>
      {state.s === "error" && (
        <p role="alert" className="text-sm text-crimson">
          {state.message}
        </p>
      )}
      <details className="source-connection">
        <summary>
          Connect the Tomorrow assistant <span>Optional</span>
        </summary>
        <p className="mt-3 text-sm text-ink-2">
          Use a connection token to send these confirmed items to your separate Tomorrow texting assistant.
        </p>
        <form onSubmit={send} className="mt-4 flex flex-col gap-3 sm:flex-row">
          {remembered ? (
            <p className="flex flex-1 items-center gap-3 text-sm" data-connected>
              Connected to Tomorrow
              <button
                type="button"
                className={buttonClass("plain")}
                onClick={() => {
                  saved.write(null);
                  setToken("");
                }}
              >
                Forget token
              </button>
            </p>
          ) : (
            <>
              <label className="sr-only" htmlFor="lens-token">
                Lens token
              </label>
              <input
                id="lens-token"
                type="password"
                autoComplete="off"
                value={typed}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Connection token"
                className="min-h-11 flex-1 rounded-lg border border-line-input bg-paper px-3 text-sm"
              />
            </>
          )}
          <button
            disabled={!count || token.trim().length < 8 || state.s === "sending"}
            className={buttonClass("quiet")}
          >
            {state.s === "sending" ? "Sending…" : `Send ${count}`}
          </button>
        </form>
        {state.s === "sent" && (
          <p role="status" className="mt-3 text-sm">
            Sent {Object.keys(state.r.created).length} to Tomorrow
            {state.r.skipped_duplicates.length ? `; ${state.r.skipped_duplicates.length} already existed` : ""}.
          </p>
        )}
        <button className={buttonClass("plain", "mt-3 px-0 text-xs underline")} disabled={!count} onClick={download}>
          Download the confirmed source data
        </button>
      </details>
    </section>
  );
}
