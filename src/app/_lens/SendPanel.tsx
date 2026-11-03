"use client";

import { useState, useSyncExternalStore } from "react";
import type { Plan, SourceMeta } from "@/lib/plan/types";
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

  const download = () => {
    const payload = build();
    if (!payload) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "lens-import.json" });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="send-title" className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-6">
      <div className="flex flex-col gap-1">
        <h2 id="send-title" className="forum-display text-2xl">
          Send to Tomorrow
        </h2>
        <p className="text-sm text-ink-2">
          {count} ready to send{waiting ? `; ${waiting} wait until you answer or edit them` : ""}. Tomorrow plans study
          time around your classes and texts you at the right moment. Only verified items go.
        </p>
      </div>
      <form onSubmit={send} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {remembered ? (
          <p className="flex flex-1 flex-wrap items-center gap-x-3 text-sm" data-connected>
            <span>Connected to Tomorrow</span>
            <button
              type="button"
              onClick={() => {
                saved.write(null);
                setToken("");
              }}
              className={buttonClass("plain", "px-0")}
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
              placeholder="Lens token from Tomorrow's Settings"
              className="min-h-11 flex-1 rounded-lg border border-line-input bg-paper px-3 text-sm"
            />
          </>
        )}
        <button disabled={!count || token.trim().length < 8 || state.s === "sending"} className={buttonClass("primary")}>
          {state.s === "sending" ? "Sending…" : `Send ${count}`}
        </button>
      </form>
      {state.s === "sent" && (
        <p role="status" className="text-sm">
          Sent {Object.keys(state.r.created).length} to Tomorrow
          {state.r.skipped_duplicates.length ? `; ${state.r.skipped_duplicates.length} were already there` : ""}.
        </p>
      )}
      {state.s === "error" && (
        <p role="alert" className="text-sm text-crimson">
          {state.message}
        </p>
      )}
      <button onClick={download} disabled={!count} className={buttonClass("plain", "self-start px-0")}>
        Download what would be sent (JSON)
      </button>
    </section>
  ); // prettier-ignore
}
