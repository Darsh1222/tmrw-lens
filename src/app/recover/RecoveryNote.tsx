"use client";
import { useId } from "react";
import type { NoteReading } from "@/lib/recovery/note";
export type RecoveryNoteDraft = { text: string; reading: NoteReading | null; applied: boolean };
export const emptyNoteDraft = (): RecoveryNoteDraft => ({ text: "", reading: null, applied: false });

export function RecoveryNote({
  draft,
  onDraftChange,
  onClear,
}: {
  draft: RecoveryNoteDraft;
  onDraftChange: (draft: RecoveryNoteDraft) => void;
  onClear: () => void;
}) {
  const id = useId();
  const questions = draft.reading?.questions ?? [];
  const edit = (text: string) => {
    if (draft.applied) onClear();
    onDraftChange({ text, reading: null, applied: false });
  };
  return (
    <div className="recovery-note">
      <label htmlFor={id}>
        Tell us what happened <span>(optional)</span>
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={280}
        value={draft.text}
        onChange={(event) => edit(event.target.value)}
        aria-invalid={questions.length > 0}
        aria-describedby={`${id}-help${questions.length ? ` ${id}-feedback` : ""}`}
        placeholder="I'm stuck and only have 20 minutes tonight."
      />
      {questions.length > 0 && (
        <div id={`${id}-feedback`} className="note-feedback" role="alert">
          {questions.map((question) => (
            <p key={question}>{question}</p>
          ))}
        </div>
      )}
      <div className="note-helper">
        <p id={`${id}-help`}>Common phrases, read on your device.</p>
        {draft.text ? (
          <button
            type="button"
            onClick={() => {
              onClear();
              onDraftChange(emptyNoteDraft());
            }}
          >
            Clear note
          </button>
        ) : (
          <button type="button" onClick={() => edit("I'm busy until 8 PM.")}>
            Try “busy until 8 PM”
          </button>
        )}
      </div>
    </div>
  );
}
