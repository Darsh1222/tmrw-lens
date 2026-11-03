"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { Answer } from "@/lib/plan/answer";
import { explainCheck, explainDate, explainTime } from "@/lib/plan/explain";
import { formatTime } from "@/lib/plan/merge";
import type { Plan } from "@/lib/plan/types";
import { formatDate, WEEKDAY_NAMES } from "@/lib/resolve/dates";
import type { Evidence } from "@/lib/schemas/evidence";
import type { Input } from "../types";
import { buttonClass, Chip, Crop, palette, Swatch } from "../ui";

// The one-tap proof: where an item was read (the crop, with SAM's outline of
// what it's written on), the exact words, and how its date was computed. It
// slides in from the side (up from the bottom on a phone), traps nothing but
// returns focus where it came from, and closes on Escape or the scrim.

const MEETING = { lecture: "lecture", discussion: "discussion", lab: "lab", other: "class" };

function Source({ inputs, e }: { inputs: Input[]; e: Evidence }) {
  const input = inputs.find((i) => i.id === e.source_id);
  const page = input?.pages.find((p) => (p.page ?? null) === (e.page ?? null)) ?? null;
  return (
    <figure className="flex flex-col gap-2">
      {page ? <Crop page={page} evidence={e} maxHeight={220} /> : null}
      <figcaption className="text-sm">
        <span className="text-ink">&ldquo;{e.quote.replace(/\s+/g, " ")}&rdquo;</span>
        <span className="text-muted">
          {" "}
          · {input?.label ?? "your answer"}
          {e.page ? `, page ${e.page}` : ""}
          {e.region ? " · outlined by SAM 3.1" : ""}
        </span>
      </figcaption>
    </figure>
  );
}

export function EvidenceDrawer({
  plan,
  inputs,
  id,
  onClose,
  onAnswer,
}: {
  plan: Plan;
  inputs: Input[];
  id: string | null;
  onClose: () => void;
  onAnswer: (a: Answer) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ title: "", date: "", time: "" });
  const open = id !== null;
  // Keep showing what was open while the drawer slides away.
  const [last, setLast] = useState<string | null>(id);
  if (id !== null && id !== last) {
    setLast(id);
    setEditing(false);
  }
  const showing = id ?? last;
  const item = plan.items.find((i) => i.id === showing) ?? null;
  const cls = plan.classes.find((c) => c.id === showing) ?? null;
  const tone = palette([...plan.items.map((i) => i.course), ...plan.classes.map((c) => c.course)]);

  // The page behind a modal stays put; the gutter is reserved in theme.css, so hiding the scrollbar moves nothing.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.style.overflow = "hidden";
    return () => void (root.style.overflow = "");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement as HTMLElement | null;
    heading.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("keydown", esc);
      back.current?.focus?.();
    };
  }, [open, id, onClose]);

  const skipped = (plan.skipped ?? []).includes(showing ?? "");
  const notVerified = item ? Object.values(item.checks).find((k) => k.status !== "verified") : null;
  const ref = item?.depends_on?.item_id ? plan.items.find((i) => i.id === item.depends_on!.item_id) : null;

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open} inert={!open}>
      <div
        onClick={onClose}
        className="absolute inset-0 bg-scrim transition-opacity duration-300 motion-reduce:transition-none"
        style={{ opacity: open ? 1 : 0 }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        className={`absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-y-auto rounded-t-2xl border border-line bg-paper p-6 transition-[translate] duration-300 ease-out motion-reduce:transition-none md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[460px] md:rounded-none md:rounded-l-2xl ${open ? "translate-0" : "translate-y-full md:translate-x-full md:translate-y-0"}`}
        data-drawer={open ? "open" : "closed"}
      >
        {(item || cls) && (
          <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-2">
                <span className="forum-caps">Proof</span>
                <h2 id="evidence-title" ref={heading} tabIndex={-1} className="forum-display text-2xl outline-none">
                  {item ? item.title : `${cls!.course} ${MEETING[cls!.meeting_type]}`}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                  <Swatch tone={tone((item ?? cls)!.course)} />
                  {(item ?? cls)!.course ?? "No course"}
                  <Chip status={(item ?? cls)!.status} />
                </div>
              </div>
              <button onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-well">
                <X size={20} weight="light" />
              </button>
            </div>

            {item && (
              <dl className="grid grid-cols-[88px_1fr] gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted">When</dt>
                <dd>
                  {item.date ? formatDate(item.date.value) : item.tba ? "Date TBA" : item.kind === "task" ? "No date" : "Date to settle"}
                  {item.time ? `, ${formatTime(item.time.start)}${item.time.end ? `–${formatTime(item.time.end)}` : ""}` : ""}
                </dd>
                {item.optional && (
                  <>
                    <dt className="text-muted">Optional</dt>
                    <dd>{item.optional}.</dd>
                  </>
                )}
                {item.tentative && (
                  <>
                    <dt className="text-muted">Tentative</dt>
                    <dd>The syllabus says &ldquo;{item.tentative.text}&rdquo;. A later date from a newer source is the likely one.</dd>
                  </>
                )}
                {item.date && (
                  <>
                    <dt className="text-muted">Date math</dt>
                    <dd>{explainDate(item.date, plan)}</dd>
                  </>
                )}
                {item.time && (
                  <>
                    <dt className="text-muted">Time</dt>
                    <dd>{explainTime(item.time, plan)}</dd>
                  </>
                )}
                {ref && (
                  <>
                    <dt className="text-muted">Linked</dt>
                    <dd>Moves with {ref.title}.</dd>
                  </>
                )}
                <dt className="text-muted">Checked</dt>
                <dd>{notVerified?.reason ?? explainCheck(item.checks.quote, "photo")}</dd>
              </dl>
            )}
            {cls && (
              <dl className="grid grid-cols-[88px_1fr] gap-x-4 gap-y-3 text-sm">
                {cls.marker && (
                  <>
                    <dt className="text-muted">Note</dt>
                    <dd>{cls.marker}</dd>
                  </>
                )}
                <dt className="text-muted">Meets</dt>
                <dd>
                  {cls.days.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(" ")} · {formatTime(cls.start)}–{formatTime(cls.end)}
                  {cls.location ? ` · ${cls.location}` : ""}
                </dd>
                <dt className="text-muted">Weeks</dt>
                <dd>
                  {cls.first_date ? `From ${formatDate(cls.first_date.value)}` : "First day still to settle"}
                  {cls.last_date ? ` to ${formatDate(cls.last_date.value)}` : ""}
                  {cls.skip_dates.length ? `; skips ${cls.skip_dates.map((s) => formatDate(s.date)).join(", ")}` : ""}
                </dd>
                {cls.first_date && (
                  <>
                    <dt className="text-muted">Date math</dt>
                    <dd>{explainDate(cls.first_date, plan)}</dd>
                  </>
                )}
              </dl>
            )}

            <section className="flex flex-col gap-4" aria-label="Where it was read">
              {(item ? item.evidence : [cls!.evidence]).map((e, n) => (
                <Source key={n} inputs={inputs} e={e} />
              ))}
            </section>

            {item && !(item.conflict && !item.conflict.chosen) && (
              editing ? (
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const changed = {
                      ...(v.title.trim() && v.title.trim() !== item.title ? { title: v.title } : {}),
                      ...(v.date && v.date !== item.date?.value ? { date: v.date } : {}),
                      ...(v.time.trim() ? { time: v.time } : {}),
                    };
                    onAnswer({ question_id: `edit:${item.id}`, option_id: "edit", value: JSON.stringify(changed) });
                    setEditing(false);
                  }}
                >
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-ink-2">What it is</span>
                    <input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={item.title} className="min-h-11 rounded-lg border border-line-input bg-card px-3" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-ink-2">Date</span>
                      <input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} className="min-h-11 rounded-lg border border-line-input bg-card px-3" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-ink-2">Time</span>
                      <input value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} placeholder={item.time ? formatTime(item.time.start) : "e.g. 3pm"} className="min-h-11 rounded-lg border border-line-input bg-card px-3" />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button className={buttonClass("primary")}>Save</button>
                    <button type="button" onClick={() => setEditing(false)} className={buttonClass("plain")}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => (setV({ title: item.title, date: item.date?.value ?? "", time: "" }), setEditing(true))} className={buttonClass("quiet")}>
                    Edit
                  </button>
                  <button disabled={skipped} onClick={() => onAnswer({ question_id: `skip:${item.id}`, option_id: "skip" })} className={buttonClass("plain")}>
                    {skipped ? "Left out" : "Leave it out"}
                  </button>
                </div>
              )
            )}
          </div>
        )}
      </aside>
    </div>
  ); // prettier-ignore
}
