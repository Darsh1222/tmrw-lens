# Recovery workspace

Open the homepage. The **Your week** tab puts one next action beside the changing schedule; **Course material** holds source review and handoff. Old `/recover` links redirect here and preserve example deep links. Enter a task or choose the labeled example. Confirm remaining work, a deadline within 14 days, and available time; then preview the automatically found plan and approve it; use what-got-in-the-way controls for recovery. The detailed comparison workspace remains at `/recover/details`. From a verified source plan, **Save schedule and continue** passes confirmed items into the guided setup; choose the source item and explicitly confirm effort and any date-only deadline's clock time. Supported weekly classes retain term end and exceptions; unsupported recurrence requires review.

## Minimal next-step loop

After approval, one card shows the next session, the whole-task remainder and the deadline. **Finished this step** is an explicit report about that step's planned work; **Plans changed** asks for the unfinished estimate and previews another complete plan. All remaining minutes must stay scheduled; completed steps are not restarted. Already approved other-task moves stay in place. Replanning never moves another task without a separate permission flow, or expands available time or alters the deadline. A no-fit result leaves the current task unchanged. Source evidence, complete remaining sessions, calendar export and undo stay under disclosure. Edited/manual deadlines are not labeled verified by their old source.

Reviewed course schedules and approved personal tasks are saved in a validated localStorage week. The selected task also has a session pointer. Multiple tasks remain saved when another is added. Saving the task does not save the person's effort-history records or identifiers. Examples cannot overwrite personal saved tasks or enter completion history. A time ending never marks work complete. An outdated plan is shown as needing an update; calendar export is disabled for past sessions. An independent validator checks the current action time before applying a recovery preview. Undo can restore the last state; withdrawing completion also removes its now-invalid effort record.

After the whole task is explicitly finished, optional actual minutes can be recorded against the original remaining-work estimate. Planned minutes and actual elapsed effort are kept distinct. Calendar exports contain remaining sessions only and cannot update existing external events. The focused card handles one selected task; the shared week retains up to 100 saved tasks. New tasks plan around existing saved sessions. Newly occurring commitments must be reflected in supplied availability; live calendar sync remains outside this implementation.

## Learning and memory

Completion records contain category, original estimate, actual minutes, timestamp, and a task-specific deduplication key. At least 3 same-category completions are required before optional calibration. The estimate uses the median of the last 10 ratios, each clamped to 0.5–2×, rounded to 5 minutes and capped at 600 minutes. This is a heuristic, not an independently validated prediction. Delete a record to correct it and record again.

Rejected start times contain only an hour and the supplied reason. They reorder candidate windows only in the default plan; they never silently remove availability or weaken constraints. A daytime preference is explicitly editable. Inspect/delete/reset controls are provided. Records are volatile by default; browser-local saving is opt-in. Saved data has no account sync or server copy. Reviewed course data is saved in the shared week; a temporary session handoff opens the next task form. Learning-history deletion does not remove the saved week.

## Planning guarantees and bounds

`RecoveryInput` validates the new boundary before building a `Draft`. `proposalProblems` independently checks combined placements for availability, fixed events, hard scheduling rules, deadline, overlap, effort accounting, and permission to move at most one other task. Recovered work may be split into at most 8 sessions; each session is at least 5 minutes. “Keep other plans fixed” changes zero other tasks. A starter includes a 10-minute break before more work. Keeping today free begins tomorrow in the supplied IANA zone.

This is bounded search, not a mathematically global optimizer: when permitted it inspects up to 6 candidate windows per other flexible task. Failure means no complete plan was found under the loaded windows, settings, and search bounds. It does not prove that every possible rearrangement is impossible. Existing extraction and recorded-agent evaluation figures do not measure this new planner; its tests are separate.

## Technical boundaries

Engine: `src/lib/recovery/engine.ts`. Import/calendar adapter: `src/lib/recovery/workspace.ts`. Guided interface: `src/app/recover/SimpleRecovery.tsx` and `NextStepCard.tsx`. Active-task state machine: `src/lib/recovery/next-step.ts`. Detailed interface: `src/app/recover/Workspace.tsx`. Source handoff: `SendPanel.tsx`. Unit tests: `tests/unit/recovery.test.ts`.

The new workspace makes no model calls and has no new server endpoint. The original Meta reader and rebuild agent remain available. The new preferences and completion records are not automatically shared with Tomorrow's private SMS app. This is implemented, useful web functionality; cross-device/SMS synchronization needs a separate integration.

## Guided entry

First use opens Course material. Save the reviewed schedule, add a task with effort and deadline, then review the automatically found placement. Manual setup remains a secondary skip option. Recovery keeps its obstacle-aware comparison. The recommended option uses the explicit obstacle: tired prefers the checked tomorrow option, stuck the checked small-start option, otherwise the default checked option. A fallback never bypasses proposal validation. Alternatives remain available in a disclosure. `/recover/details` preserves the full comparison controls. The guided path shows the next session, supports calendar export and undo, and presents planning preferences in a visible panel.

## Schedule projection

The calendar reads the same validated request and proposal as the task card. It displays exact session times, supplied fixed commitments and deadlines. Motion connects old and new positions; preview and approval have distinct labels. Completed effort is removed from remaining sessions; the shared calendar retains reported finished sessions as history. Midnight-spanning events split by civil date in the request time zone, including DST; visual minimum heights and collision lanes never alter actual timestamps. Personal tasks never receive invented missed-session events. Example-only original-week comparisons are clearly labeled. Motion respects the system reduced-motion preference.

## Typed recovery notes

“What got in the way?” accepts a short note. **Preview my plan** reads common scheduling phrases locally, asks inline about unclear constraints, and shows the interpretation alongside the proposed plan before approval. Examples: “I'm busy until 8 PM”, “I'm stuck and only have 20 minutes tonight”, “I need 90 minutes to finish”, and “Start with five minutes”. A today-only cap applies to the total scheduled work today. It does not discard the remainder. Ambiguous or unsupported text asks for clarification; quick answers remain available. Changing the note removes its applied constraints until the next preview. The raw text is component-local only; the resulting structured constraints can be retained in the approved task. No general-purpose language-model understanding is claimed.

## November 17 usability refinement

The main workspace uses compact task-focused headings, visible quick answers and a single preview action for typed notes. Optional first-step controls remain in disclosure. Phones have explicit Next step/Review plan and Schedule views; switching preserves the mounted working state. The review action remains separate from approval. More readable calendar labels and flat session lists replace redundant headings and nested surfaces.

## Saved-week behavior

The full-week calendar keeps tasks on their original dates when paging or refreshing. It does not repeat one-off work every week. Regular classes recur with their source term bounds and exceptions. Office hours are optional help; their separate setting applies to new task placement. Existing task sessions are protected during new-task scheduling and recovery. This is incremental placement, not a global reprioritization of all saved tasks or a guarantee of a mathematically best schedule. Updated course sources may require manually recovering already-approved tasks. Source bytes/photos are not persisted in the shared week, only reviewed import facts and their evidence. Browser storage may be unavailable; saving failures are shown. No cross-device or external calendar synchronization.
