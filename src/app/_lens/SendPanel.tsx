"use client";

import { useState, useSyncExternalStore } from "react";
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

  return (
    <section aria-labelledby="send-title" className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-6">
      <div className="flex flex-col gap-1">
        <h2 id="send-title" className="forum-display text-2xl">
          Send to Tomorrow
        </h2>
        <p className="text-sm text-ink-2">
          Tomorrow is the texting assistant that keeps this plan going: it plans study time around your classes, texts
          you when a session slips, and asks Lens to rebuild the week.
        </p>
        <p className="text-sm">
          {count} ready to send{waiting ? `; ${waiting} wait until you answer or edit them` : ""}. Only verified items
          go.
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
      <div className="flex flex-col items-start gap-1">
        <button onClick={calendar} disabled={!count} className={buttonClass("quiet")}>
          Add to calendar (.ics)
        </button>
        <p className="text-xs text-ink-2">Or skip Tomorrow: the same verified items, as a file for any calendar app.</p>
      </div>
      <details className="text-sm text-ink-2">
        <summary className="cursor-pointer hover:text-ink">Details</summary>
        <div className="mt-2 flex flex-col items-start gap-1">
          <p>Each item goes with its quote and date math. The connection uses a token from Tomorrow&apos;s Settings.</p>
          <button onClick={download} disabled={!count} className={buttonClass("plain", "min-h-9 px-0 underline underline-offset-4")}>
            Download what would be sent
          </button>
        </div>
      </details>
    </section>
  ); // prettier-ignore
}
