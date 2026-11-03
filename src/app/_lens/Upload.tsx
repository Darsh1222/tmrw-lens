"use client";

import { FileText, Trash, UploadSimple } from "@phosphor-icons/react";
import { Reveal } from "./Reveal";
import { useEffect, useRef, useState } from "react";
import type { SourceKind } from "@/lib/schemas/evidence";
import { KIND_LABEL } from "./prepare";
import type { Input } from "./types";
import { buttonClass, money } from "./ui";

// Adding your week: a drop zone that takes PDFs, photos, screenshots, and
// pasted Testudo text, then a thumbnail per input with what's happening to it
// in plain words. Progress is real: pages read over pages to read, and the
// seconds the current read has taken; nothing spins for show.

const PICKABLE: SourceKind[] = ["testudo_screenshot", "whiteboard_photo", "notes_photo", "lms_screenshot"];

function useTicking(on: boolean) {
  // Starts at 0 (no clock read while prerendering); ticks only while something is being read.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function statusLine(i: Input, now: number): string {
  if (i.status === "opening") return "Opening…";
  if (i.status === "ready") return i.pages.length > 1 ? `${i.pages.length} pages, ready to read` : "Ready to read";
  if (i.status === "error") return i.error ?? "Couldn't read it.";
  if (i.status === "read") return i.recorded ? "Read (recorded sample)" : `Read · ${money(i.cost_usd)}`;
  const secs = i.startedAt && now ? Math.max(0, Math.round((now - i.startedAt) / 1000)) : 0;
  const what =
    i.pages.length > 1
      ? `Reading page ${Math.min(i.done + 1, i.pages.length)} of ${i.pages.length}`
      : i.kind === "whiteboard_photo" || i.kind === "notes_photo"
        ? "Reading and outlining what's on it"
        : i.kind === "testudo_text"
          ? "Reading the text"
          : "Reading the screenshot";
  return `${what}… ${secs}s`;
}

export function Upload({
  inputs,
  busy,
  onAdd,
  onPaste,
  onRead,
  onSample,
  onKind,
  onRemove,
  found,
}: {
  inputs: Input[];
  busy: string | null;
  onAdd: (files: FileList | File[]) => void;
  onPaste: (text: string) => void;
  onRead: () => void;
  onSample: () => void;
  onKind: (id: string, kind: SourceKind) => void;
  onRemove: (id: string) => void;
  /** Per input: how many things were found in it, and how many are verified. */
  found: Record<string, { all: number; verified: number }>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState("");
  const reading = inputs.some((i) => i.status === "reading");
  const now = useTicking(reading);
  const unread = inputs.filter((i) => i.status === "ready" || i.status === "error");
  const live = inputs.filter((i) => !i.recorded);
  const pages = live.reduce((a, i) => a + i.pages.length, 0);
  const done = live.reduce((a, i) => a + i.done, 0);

  return (
    <section id="upload" aria-labelledby="upload-title" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="forum-caps">I · Read</span>
        <Reveal id="upload-title" className="forum-display text-3xl sm:text-4xl" text="Add your week." />
        <p className="max-w-2xl text-ink-2">
          Add a syllabus, your Testudo schedule, a whiteboard or notes photo, or a course site&apos;s to-do list. Lens
          reads each page with Muse Spark, outlines photos with SAM 3.1, and keeps none of them.
        </p>
      </div>

      <div
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) onAdd(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors ${over ? "border-ink bg-well" : "border-line-strong bg-card"}`}
      >
        <UploadSimple size={32} weight="light" aria-hidden className="text-ink-2" />
        <div className="flex flex-col gap-1">
          <p className="text-lg">Drop PDFs, photos, or screenshots here</p>
          <p className="text-sm text-ink-2">PDF (up to 12 pages), JPEG, PNG, or HEIC. Up to 25 pages a day, free.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <button onClick={() => fileRef.current?.click()} className={buttonClass("primary")}>
            Choose files
          </button>
          <button onClick={onSample} className={buttonClass("quiet")}>
            Try the sample week
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.pdf,.txt"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            if (e.target.files?.length) onAdd(e.target.files);
            e.target.value = "";
          }}
        />
        <details className="w-full max-w-xl text-left text-sm">
          <summary className="cursor-pointer text-center text-ink-2 hover:text-ink">Or paste your Testudo schedule as text</summary>
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={5}
              aria-label="Testudo schedule text"
              className="rounded-lg border border-line-input bg-paper p-3 font-mono text-xs"
            />
            <button
              onClick={() => (onPaste(paste), setPaste(""))}
              disabled={!paste.trim()}
              className={buttonClass("quiet", "self-start")}
            >
              Add it
            </button>
          </div>
        </details>
      </div>
      <p className="text-sm text-ink-2">
        Next, Lens reads each page, checks every date against its words, and asks about anything unclear. You&apos;ll
        review everything before anything is sent.
      </p>
      {busy && (
        <p role="status" className="text-sm text-ink-2">
          {busy}
        </p>
      )}

      {inputs.length > 0 && (
        <div className="flex flex-col gap-4">
          {live.length > 0 && (
            <div className="flex flex-col gap-2" role="status" aria-live="polite">
              <div className="flex items-baseline justify-between text-sm">
                <span>
                  {reading ? "Reading" : done === pages ? "Read" : "Ready"} · {done} of {pages}{" "}
                  {pages === 1 ? "page" : "pages"}
                </span>
                <span className="text-muted">{money(live.reduce((a, i) => a + i.cost_usd, 0))}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-well" aria-hidden>
                <div className="forum-bar h-full bg-ink" style={{ transform: `scaleX(${pages ? done / pages : 0})` }} />
              </div>
            </div>
          )}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {inputs.map((i) => {
              const thumb = i.pages[0]?.url;
              const f = found[i.id];
              return (
                <li key={i.id} className="flex flex-col overflow-hidden rounded-xl border border-line bg-card">
                  <div className="relative aspect-[4/3] bg-well">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a local object URL
                      <img src={thumb} alt={`${i.label}: ${i.name}`} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-ink-2">
                        <FileText size={32} weight="light" aria-hidden />
                      </div>
                    )}
                    {i.pages.length > 1 && (
                      <span className="absolute bottom-2 right-2 rounded-md bg-paper px-1.5 text-xs">{i.pages.length} pages</span>
                    )}
                    {i.status === "reading" && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-well" aria-hidden>
                        <div className="forum-bar h-full bg-ink" style={{ transform: `scaleX(${i.done / i.pages.length})` }} />
                      </div>
                    )}
                  </div>
                  <div className="flex min-h-[92px] flex-1 flex-col gap-1 p-3">
                    <div className="flex items-start justify-between gap-2">
                      {i.status === "ready" && PICKABLE.includes(i.kind) ? (
                        <select
                          value={i.kind}
                          onChange={(e) => onKind(i.id, e.target.value as SourceKind)}
                          aria-label={`What ${i.name} is`}
                          className="min-h-9 min-w-0 flex-1 rounded-md border border-line-input bg-paper px-1.5 text-sm"
                        >
                          {PICKABLE.map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="truncate text-sm font-medium">{i.label}</span>
                      )}
                      {!i.recorded && i.status !== "reading" && (
                        <button onClick={() => onRemove(i.id)} aria-label={`Remove ${i.label}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-well hover:text-ink">
                          <Trash size={16} weight="light" />
                        </button>
                      )}
                    </div>
                    <p className={`text-xs ${i.status === "error" ? "text-crimson" : "text-ink-2"}`}>
                      {statusLine(i, now)}
                    </p>
                    {i.status === "read" && f && (
                      <p className="text-xs text-ink-2">
                        {f.all} found · {f.verified} verified
                      </p>
                    )}
                    {i.note && <p className="text-xs text-muted">{i.note}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          {unread.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={onRead} disabled={reading} className={buttonClass("primary")}>
                {reading ? "Reading…" : unread.some((i) => i.status === "error") ? "Try again" : `Read ${unread.length === 1 ? "it" : `all ${unread.length}`}`}
              </button>
              {inputs.some((i) => i.error && /Come back tomorrow/.test(i.error)) && (
                <button onClick={onSample} className={buttonClass("quiet")}>
                  Try the sample week instead
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  ); // prettier-ignore
}
