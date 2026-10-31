"use client";

import { useState } from "react";
import type { Plan, SourceMeta } from "@/lib/plan/types";
import { NotSendable, sendable, toImport, type ImportResponse } from "@/lib/tomorrow/contract";

// Send to Tomorrow: only verified items go. Everything else waits, and says so.
// The Lens token comes from Tomorrow's Settings; it's kept in this page only.

export function SendPanel({ plan, sources }: { plan: Plan; sources: SourceMeta[] }) {
  const [token, setToken] = useState("");
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
    if (!res?.ok) setState({ s: "error", message: body?.error ?? "Couldn't send. Try again." });
    else setState({ s: "sent", r: body as ImportResponse });
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
    <section aria-label="Send to Tomorrow" className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <h2 className="font-semibold">Send to Tomorrow</h2>
      <p className="text-sm text-text-secondary">
        {count} ready to send{waiting ? `; ${waiting} wait until you answer or edit them` : ""}. Tomorrow plans study
        time around your classes and reminds you.
      </p>
      <form onSubmit={send} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Lens token from Tomorrow's Settings"
          aria-label="Lens token"
          className="flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
        />
        <button
          disabled={!count || token.trim().length < 8 || state.s === "sending"}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {state.s === "sending" ? "Sending…" : `Send ${count}`}
        </button>
      </form>
      {state.s === "sent" && (
        <p className="text-sm text-verified">
          Sent {Object.keys(state.r.created).length} to Tomorrow
          {state.r.skipped_duplicates.length ? `; ${state.r.skipped_duplicates.length} were already there` : ""}.
        </p>
      )}
      {state.s === "error" && <p className="text-sm text-unverified">{state.message}</p>}
      <button onClick={download} disabled={!count} className="self-start text-xs text-text-secondary underline-offset-2 hover:underline disabled:opacity-50">
        Download what would be sent (JSON)
      </button>
    </section>
  ); // prettier-ignore
}
