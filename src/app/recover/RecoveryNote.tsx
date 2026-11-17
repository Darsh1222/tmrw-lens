"use client";
import { useId } from "react";
import type { RebuildRequest } from "@/lib/rebuild/contract";
import { readRecoveryNote, type NoteReading, type RecoveryNoteSettings } from "@/lib/recovery/note";
import { buttonClass } from "../_lens/styles";

export type RecoveryNoteDraft = { text: string; reading: NoteReading | null; applied: boolean };
export const emptyNoteDraft = (): RecoveryNoteDraft => ({ text: "", reading: null, applied: false });

export function RecoveryNote({
  draft,
  onDraftChange,
  request,
  onApply,
  onClear,
}: {
  draft: RecoveryNoteDraft;
  onDraftChange: (draft: RecoveryNoteDraft) => void;
  request: RebuildRequest;
  onApply: (settings: RecoveryNoteSettings) => void;
  onClear: () => void;
}) {
  const id = useId();
  const { text: note, reading, applied } = draft;
  const edit = (value: string) => {
    if (applied) onClear();
    onDraftChange({ text: value, reading: null, applied: false });
  };
  return (
    <div className="recovery-note">
      <label htmlFor={id} className="block text-sm font-medium">
        Tell us what happened
      </label>
      <p id={`${id}-help`} className="mt-1 text-sm text-ink-2">
        In your own words, or choose an option below.
      </p>
      <textarea
        id={id}
        aria-describedby={`${id}-help ${id}-privacy`}
        rows={3}
        maxLength={280}
        value={note}
        onChange={(e) => edit(e.target.value)}
        placeholder="I'm stuck and only have 20 minutes tonight."
        className="mt-3 w-full resize-y rounded-xl border border-line-input bg-paper px-4 py-3 text-base"
      />
      <div className="mt-2 flex flex-wrap gap-2" aria-label="Example notes">
        {["I'm busy until 8 PM.", "I need 90 minutes to finish."].map((example) => (
          <button
            key={example}
            type="button"
            className="rounded-full border border-line px-3 py-2 text-xs text-ink-2 hover:text-ink"
            onClick={() => edit(example)}
          >
            {example}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!note.trim()}
        className={buttonClass("quiet", "mt-3 w-full")}
        onClick={() => {
          const next = readRecoveryNote(note, request);
          onDraftChange({ text: note, reading: next, applied: !next.questions.length });
          if (!next.questions.length) {
            onApply(next.settings);
          } else {
            onClear();
          }
        }}
      >
        Use my note
      </button>
      {reading && (
        <div
          role="status"
          className={`mt-3 rounded-xl border p-4 text-sm ${reading.questions.length ? "border-line bg-paper" : "border-crimson/40 bg-paper"}`}
        >
          <p className="font-medium">{reading.questions.length ? "One thing to check" : "Here’s what I read"}</p>
          <ul className="mt-2 flex list-disc flex-col gap-2 pl-4">
            {(reading.questions.length ? reading.questions : reading.understood).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {!reading.questions.length && (
            <p className="mt-3 text-xs text-ink-2">Review the plan before applying it. Nothing is moved yet.</p>
          )}
          <button
            type="button"
            className="mt-3 text-xs underline underline-offset-4"
            onClick={() => {
              onClear();
              onDraftChange(emptyNoteDraft());
            }}
          >
            Clear note settings
          </button>
        </div>
      )}
      <p id={`${id}-privacy`} className="mt-3 text-xs text-ink-2">
        Reads common scheduling phrases on your device. Your note isn’t sent or saved.
      </p>
    </div>
  );
}
