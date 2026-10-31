"use client";

import { useState } from "react";
import type { Answer } from "@/lib/plan/answer";
import { explainCheck, explainDate, explainTime } from "@/lib/plan/explain";
import { formatTime } from "@/lib/plan/merge";
import type { ClassBlock, Plan, PlanItem } from "@/lib/plan/types";
import { formatDate, WEEKDAY_NAMES } from "@/lib/resolve/dates";
import type { Input } from "./types";
import { Badge } from "./ui";

// What Lens found: classes, then dated items in order, each with its status,
// how its date was computed, and how its reading was checked. Clicking one
// shows where it was read.

const MEETING = { lecture: "lecture", discussion: "discussion", lab: "lab", other: "class" };

const kindOf = (inputs: Input[], sourceId: string) => {
  const k = inputs.find((i) => i.id === sourceId)?.kind;
  return k === "syllabus_pdf" ? "document" : k === "testudo_text" ? "text" : "photo";
};

function Row({
  id,
  selected,
  onSelect,
  skipped,
  children,
  onSkip,
  editor,
}: {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
  skipped: boolean;
  children: React.ReactNode;
  onSkip: () => void;
  editor: ((close: () => void) => React.ReactNode) | null;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <li
      id={`row-${id}`}
      className={`rounded-lg border p-3 ${selected ? "border-accent bg-accent/5" : "border-border"} ${skipped ? "opacity-50" : ""}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(id)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(id))}
        className="flex cursor-pointer flex-col gap-1"
      >
        {children}
      </div>
      <div className="mt-2 flex gap-3 text-xs text-text-secondary">
        {editor && (
          <button onClick={() => setEditing((v) => !v)} className="hover:text-text">
            {editing ? "Cancel" : "Edit"}
          </button>
        )}
        <button onClick={onSkip} className="hover:text-text" disabled={skipped}>
          {skipped ? "Left out" : "Leave out"}
        </button>
      </div>
      {editing && editor?.(() => setEditing(false))}
    </li>
  );
}

function ItemEditor({ item, onAnswer, close }: { item: PlanItem; onAnswer: (a: Answer) => void; close: () => void }) {
  const [v, setV] = useState({ title: item.title, date: item.date?.value ?? "", time: "" });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const changed = {
          ...(v.title.trim() !== item.title ? { title: v.title } : {}),
          ...(v.date && v.date !== item.date?.value ? { date: v.date } : {}),
          ...(v.time.trim() ? { time: v.time } : {}),
        };
        onAnswer({ question_id: `edit:${item.id}`, option_id: "edit", value: JSON.stringify(changed) });
        close();
      }}
      className="mt-2 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]"
    >
      <input aria-label="What it is" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} className="rounded-md border border-border bg-bg px-2 py-1 text-sm" />
      <input aria-label="Date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} className="rounded-md border border-border bg-bg px-2 py-1 text-sm" />
      <input aria-label="Time" placeholder={item.time ? formatTime(item.time.start) : "time"} value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} className="rounded-md border border-border bg-bg px-2 py-1 text-sm" />
      <button className="rounded-md bg-accent px-3 py-1 text-sm text-white">Save</button>
    </form>
  ); // prettier-ignore
}

function ClassBody({ c, plan }: { c: ClassBlock; plan: Plan }) {
  const days = c.days.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(" ");
  const breakName = (id: string) => plan.term_breaks.breaks.find((b) => b.id === id)?.name ?? "a break";
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge status={c.status} />
        <span className="font-medium">
          {c.course} {MEETING[c.meeting_type]}
        </span>
        <span className="text-sm text-text-secondary">
          {days} · {formatTime(c.start)}-{formatTime(c.end)}
          {c.location ? ` · ${c.location}` : ""}
        </span>
      </div>
      <p className="text-xs text-text-secondary">
        {c.first_date ? `Weekly from ${formatDate(c.first_date.value)}` : "Weekly, from a first day still to settle"}
        {c.last_date ? ` to ${formatDate(c.last_date.value)}` : ", end still to settle"}
        {c.skip_dates.length
          ? `; skips ${c.skip_dates.map((s) => formatDate(s.date)).join(", ")} (${[...new Set(c.skip_dates.map((s) => breakName(s.break_id)))].join(", ")})`
          : ""}
        .
      </p>
      <p className="text-xs text-text-secondary">
        {[c.checks.quote, c.checks.days, c.checks.time].find((k) => k.status !== "verified")?.reason ??
          explainCheck(c.checks.quote, c.source.kind === "testudo_text" ? "text" : "photo")}
      </p>
    </>
  );
}

function ItemBody({ item, plan, inputs }: { item: PlanItem; plan: Plan; inputs: Input[] }) {
  const notVerified = Object.values(item.checks).find((k) => k.status !== "verified");
  const ref = item.depends_on?.item_id ? plan.items.find((i) => i.id === item.depends_on!.item_id) : null;
  const sources = [
    ...new Set(item.evidence.map((e) => inputs.find((i) => i.id === e.source_id)?.label ?? "your answer")),
  ];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge status={item.status} />
        <span className="font-medium">{item.title}</span>
        {item.course && <span className="rounded bg-surface px-1.5 text-xs text-text-secondary">{item.course}</span>}
        <span className="text-sm">
          {item.date ? formatDate(item.date.value) : item.kind === "task" ? "No date" : "Date to settle"}
          {item.time ? `, ${formatTime(item.time.start)}${item.time.end ? `-${formatTime(item.time.end)}` : ""}` : ""}
        </span>
      </div>
      {item.date && (
        <p className="text-xs text-text-secondary">
          {item.date.trace.rule === "answer" ? "" : "Computed from "}
          {explainDate(item.date, plan)}
        </p>
      )}
      {item.time && <p className="text-xs text-text-secondary">Time: {explainTime(item.time, plan)}</p>}
      {ref && <p className="text-xs text-text-secondary">Moves with {ref.title}.</p>}
      <p className="text-xs text-text-secondary">
        {notVerified?.reason ?? explainCheck(item.checks.quote, kindOf(inputs, item.evidence[0]?.source_id ?? ""))} ·{" "}
        {sources.join(" + ")}
      </p>
    </>
  );
}

export function Items({
  plan,
  inputs,
  selected,
  onSelect,
  onAnswer,
}: {
  plan: Plan;
  inputs: Input[];
  selected: string | null;
  onSelect: (id: string) => void;
  onAnswer: (a: Answer) => void;
}) {
  const skipped = new Set(plan.skipped ?? []);
  const items = [...plan.items].sort(
    (a, b) => (a.date?.value ?? "9999").localeCompare(b.date?.value ?? "9999") || a.title.localeCompare(b.title),
  );
  const skip = (id: string) => () => onAnswer({ question_id: `skip:${id}`, option_id: "skip" });
  return (
    <div className="flex flex-col gap-4">
      {plan.classes.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-secondary">Classes ({plan.classes.length})</h2>
          <ul className="flex flex-col gap-2">
            {plan.classes.map((c) => (
              <Row key={c.id} id={c.id} selected={selected === c.id} onSelect={onSelect} skipped={skipped.has(c.id)} onSkip={skip(c.id)} editor={null}>
                <ClassBody c={c} plan={plan} />
              </Row>
            ))}
          </ul>
        </section>
      )}
      {items.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-secondary">Dates and tasks ({items.length})</h2>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <Row
                key={item.id}
                id={item.id}
                selected={selected === item.id}
                onSelect={onSelect}
                skipped={skipped.has(item.id)}
                onSkip={skip(item.id)}
                editor={item.conflict && !item.conflict.chosen ? null : (close) => <ItemEditor item={item} onAnswer={onAnswer} close={close} />}
              >
                <ItemBody item={item} plan={plan} inputs={inputs} />
              </Row>
            ))}
          </ul>
        </section>
      )}
      {plan.crossed_out.length > 0 && (
        <p className="text-xs text-text-secondary">
          Left out because they&apos;re crossed off: {plan.crossed_out.map((c) => `“${c.title}”`).join(", ")}.
        </p>
      )}
    </div>
  ); // prettier-ignore
}
