# Recovery workspace

Open `/recover`. A labeled synthetic week is available without AI credentials. For real work, choose **Use my own week**, enter the remaining minutes and a confirmed deadline within 14 days, and review study/sleep hours and busy time. Or open a verified Lens plan, choose **Open recovery workspace**, then **Load verified Lens handoff**. Only confirmed items pass through the existing import audit. Select a source item and explicitly confirm remaining effort and the proposed time on any date-only deadline. Weekly classes are expanded only for supported recurrence rules, preserving weekday, local time, term end, and exceptions. Unsupported recurrences require manual review.

## User flow

1. Review the loaded task and commitments.
2. Describe the obstacle if useful; the simple phrase matcher can suggest a label, which you can correct.
3. Set remaining effort, category, and maximum small-step length. Include any interruption as explicit busy time; text does not silently change availability.
4. Optionally enable effort calibration and comparison of moving one flexible task.
5. Compare complete proposals. Every proposal displays sessions, the complete remaining-work allocation, and additional changes. No feasible result produces a capacity/constraint explanation instead of silently dropping the task.
6. Apply a proposal to the visit's working plan. Undo restores the source. Export creates an .ics for recovered work only. It does not update existing external events; when another task moves, update that calendar event separately.
7. After finishing the whole recovered task, explicitly record actual minutes once. A calendar event ending is not completion. Synthetic example mode disables personal completion logging.

## Learning and memory

Completion records contain category, original estimate, actual minutes, timestamp, and a task-specific deduplication key. At least 3 same-category completions are required before optional calibration. The estimate uses the median of the last 10 ratios, each clamped to 0.5–2×, rounded to 5 minutes and capped at 600 minutes. This is a heuristic, not an independently validated prediction. Delete a record to correct it and record again.

Rejected start times contain only an hour and the supplied reason. They reorder candidate windows only in the default plan; they never silently remove availability or weaken constraints. A daytime preference is explicitly editable. Inspect/delete/reset controls are provided. Records are volatile by default; browser-local saving is opt-in. Saved data has no account sync or server copy. A verified handoff uses sessionStorage and may be removed by Reset all memory.

## Planning guarantees and bounds

`RecoveryInput` validates the new boundary before building a `Draft`. `proposalProblems` independently checks combined placements for availability, fixed events, hard scheduling rules, deadline, overlap, effort accounting, and permission to move at most one other task. Recovered work may be split into at most 8 sessions; each session is at least 5 minutes. “Keep other plans fixed” changes zero other tasks. A starter includes a 10-minute break before more work. Keeping today free begins tomorrow in the supplied IANA zone.

This is bounded search, not a mathematically global optimizer: when permitted it inspects up to 6 candidate windows per other flexible task. Failure means no complete plan was found under the loaded windows, settings, and search bounds. It does not prove that every possible rearrangement is impossible. Existing extraction and recorded-agent evaluation figures do not measure this new planner; its tests are separate.

## Technical boundaries

Engine: `src/lib/recovery/engine.ts`. Import/calendar adapter: `src/lib/recovery/workspace.ts`. Interface: `src/app/recover/Workspace.tsx`. Source handoff: `SendPanel.tsx`. Unit tests: `tests/unit/recovery.test.ts`.

The new workspace makes no model calls and has no new server endpoint. The original Meta reader and rebuild agent remain available. The new preferences and completion records are not automatically shared with Tomorrow's private SMS app. This is implemented, useful web functionality; cross-device/SMS synchronization needs a separate integration.
