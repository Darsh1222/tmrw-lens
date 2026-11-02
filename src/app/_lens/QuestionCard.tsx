"use client";

import { useState } from "react";
import type { Answer } from "@/lib/plan/answer";
import type { Plan, Question } from "@/lib/plan/types";
import type { Evidence } from "@/lib/schemas/evidence";
import type { Input } from "./types";
import { buttonClass, Crop } from "./ui";

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
      <figcaption className="text-xs text-ink-2">
        &ldquo;{evidence.quote}&rdquo; · {label}
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
      <span className="text-ink-2">{label}</span>
      <input
        value={value[k] ?? ""}
        onChange={set(k)}
        className="min-h-11 rounded-lg border border-line-input bg-paper px-3"
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
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-2xl border border-line bg-card p-6"
      aria-label="A question"
    >
      <div className="flex items-baseline justify-between gap-2 text-sm text-ink-2">
        <span className="forum-caps">
          Question {index} of {total}
        </span>
        {onLater && (
          <button type="button" onClick={onLater} className="min-h-11 underline-offset-4 hover:underline">
            Later
          </button>
        )}
      </div>
      <p className="forum-display text-xl leading-snug">{q.prompt}</p>

      <fieldset className={conflict ? "grid gap-3 sm:grid-cols-2" : "flex flex-col gap-2"}>
        <legend className="sr-only">Answers</legend>
        {q.options.map((o) => (
          <label
            key={o.id}
            className={`flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors ${choice === o.id ? "border-ink bg-paper" : "border-line hover:border-line-strong"} ${conflict && !o.evidence ? "sm:col-span-2" : ""}`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name={q.id}
                checked={choice === o.id}
                onChange={() => setChoice(o.id)}
                className="h-4 w-4 accent-[var(--tm-text)]"
              />
              <span>{o.label}</span>
              {o.id === q.suggested && (
                <span className="rounded-md bg-butter px-1.5 py-0.5 text-xs text-ink">Suggested</span>
              )}
            </span>
            {conflict && o.evidence ? <Evidenced inputs={inputs} evidence={o.evidence} /> : null}
          </label>
        ))}
      </fieldset>
      {q.suggested && q.why_suggested && (
        <p className="text-sm text-ink-2">Why it&apos;s suggested: {q.why_suggested}</p>
      )}
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
            className="min-h-11 rounded-lg border border-line-input bg-paper px-3"
          />
        ))}
      {error && <p className="text-sm text-crimson">{error}</p>}
      <div>
        <button
          type="submit"
          disabled={!option || (typing && q.input !== "fields" && !typed.trim())}
          className={buttonClass("primary")}
        >
          Answer
        </button>
      </div>
    </form>
  );
}
