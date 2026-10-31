"use client";

import { useState } from "react";
import type { Answer } from "@/lib/plan/answer";
import type { Plan, Question } from "@/lib/plan/types";
import type { Evidence } from "@/lib/schemas/evidence";
import type { Input } from "./types";
import { Crop } from "./ui";

// One question at a time. The likely answer is pre-selected, with its reason,
// but nothing is applied until the person presses Answer. A conflict shows
// each source's own words side by side.

function pageOf(inputs: Input[], e: Evidence) {
  const input = inputs.find((i) => i.id === e.source_id);
  return input?.pages.find((p) => (p.page ?? null) === (e.page ?? null)) ?? null;
}

function Evidenced({ inputs, evidence }: { inputs: Input[]; evidence: Evidence }) {
  const page = pageOf(inputs, evidence);
  const label = inputs.find((i) => i.id === evidence.source_id)?.label;
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      {page ? <Crop page={page} evidence={evidence} /> : null}
      <figcaption className="text-xs text-text-secondary">
        “{evidence.quote}” · {label}
        {evidence.page ? `, page ${evidence.page}` : ""}
      </figcaption>
    </figure>
  );
}

function Fields({
  q,
  plan,
  value,
  onChange,
}: {
  q: Question;
  plan: Plan;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  const field = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label key={k} className="flex flex-col gap-1 text-sm">
      <span className="text-text-secondary">{label}</span>
      <input
        value={value[k] ?? ""}
        onChange={set(k)}
        className="rounded-md border border-border bg-bg px-2 py-1.5"
        {...props}
      />
    </label>
  );
  const item = plan.items.find((i) => i.id === q.about);
  if (item) return <div className="grid gap-2 sm:grid-cols-3">{[field("title", "What it is", { placeholder: item.title }), field("date", "Date", { type: "date" }), field("time", "Time", { placeholder: "e.g. 11:59pm" })]}</div>; // prettier-ignore
  const cls = plan.classes.find((c) => c.id === q.about);
  if (cls) return <div className="grid gap-2 sm:grid-cols-3">{[field("days", "Days", { placeholder: "MWF" }), field("start", "Starts", { placeholder: "10:00am" }), field("end", "Ends", { placeholder: "10:50am" })]}</div>; // prettier-ignore
  // A screenshot's class days: one field per class.
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {plan.classes
        .filter((c) => c.source.id === q.about)
        .map((c) => field(c.id, `${c.course} ${c.meeting_type} ${c.start}`, { placeholder: "MWF" }))}
    </div>
  );
}

export function QuestionCard({
  q,
  plan,
  inputs,
  index,
  total,
  error,
  onAnswer,
  onLater,
}: {
  q: Question;
  plan: Plan;
  inputs: Input[];
  index: number;
  total: number;
  error: string | null;
  onAnswer: (a: Answer) => void;
  onLater: (() => void) | null;
}) {
  const [choice, setChoice] = useState<string | null>(q.suggested);
  const [typed, setTyped] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const option = q.options.find((o) => o.id === choice);
  const typing = option?.value === null;
  const conflict = q.type === "conflict";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!option) return;
    const value = !typing
      ? null
      : q.input === "fields"
        ? JSON.stringify(Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim())))
        : typed.trim();
    onAnswer({ question_id: q.id, option_id: option.id, value });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent/5 p-4">
      <div className="flex items-baseline justify-between gap-2 text-xs text-text-secondary">
        <span>
          Question {index} of {total}
        </span>
        {onLater && (
          <button type="button" onClick={onLater} className="underline-offset-2 hover:underline">
            Later
          </button>
        )}
      </div>
      <p className="font-medium">{q.prompt}</p>

      <fieldset className={conflict ? "grid gap-3 sm:grid-cols-2" : "flex flex-col gap-2"}>
        <legend className="sr-only">Answers</legend>
        {q.options.map((o) => (
          <label
            key={o.id}
            className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 ${choice === o.id ? "border-accent bg-bg" : "border-border"} ${conflict && !o.evidence ? "sm:col-span-2" : ""}`}
          >
            <span className="flex items-center gap-2">
              <input type="radio" name={q.id} checked={choice === o.id} onChange={() => setChoice(o.id)} />
              <span>{o.label}</span>
              {o.id === q.suggested && <span className="text-xs text-accent">Suggested</span>}
            </span>
            {conflict && o.evidence ? <Evidenced inputs={inputs} evidence={o.evidence} /> : null}
          </label>
        ))}
      </fieldset>
      {q.suggested && q.why_suggested && <p className="text-sm text-text-secondary">Why: {q.why_suggested}</p>}
      {!conflict && q.options.find((o) => o.evidence)?.evidence && (
        <Evidenced inputs={inputs} evidence={q.options.find((o) => o.evidence)!.evidence!} />
      )}

      {typing &&
        (q.input === "fields" ? (
          <Fields q={q} plan={plan} value={fields} onChange={setFields} />
        ) : (
          <input
            autoFocus
            type={q.input === "date" ? "date" : "text"}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={
              q.input === "time" ? "e.g. 3pm or 2-3:15pm" : q.input === "dates" ? "e.g. Nov 25-29; Mar 16-20" : q.input === "course" ? "e.g. MATH141" : "" // prettier-ignore
            }
            aria-label="Your answer"
            className="rounded-md border border-border bg-bg px-2 py-1.5"
          />
        ))}
      {error && <p className="text-sm text-unverified">{error}</p>}
      <div>
        <button
          type="submit"
          disabled={!option || (typing && q.input !== "fields" && !typed.trim())}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Answer
        </button>
      </div>
    </form>
  );
}
