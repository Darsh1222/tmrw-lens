# Hackathon log

Tomorrow Lens is being built from scratch for the Meta Global AI Developer Hackathon (build window Oct 27 to Nov 4,
2026). Everything in this repository was written during the hackathon. It is built solo with AI coding assistance
(Claude Code).

Lens connects to Tomorrow, a separate planning app I built before the hackathon, which is not part of this repository
or this submission. Lens sends it confirmed items and answers its "rebuild" calls over two small HTTP contracts
described in [docs/PLAN.md](docs/PLAN.md). The Tomorrow side of those contracts is added during the hackathon too,
and is noted here when it lands.

Meta models used: Muse Spark (`muse-spark-1.3`) for extraction, verification, and the rebuild agent; SAM 3.1
(`sam-3.1`) for segmentation. Both are called through Meta Model API.

## What's new

### Oct 27

- Repository created (README, Apache-2.0 license).

### Oct 28

- Plan written down ([docs/PLAN.md](docs/PLAN.md)).
- Next.js 16 + TypeScript scaffold, CI (typecheck, lint, format, tests, build, gitleaks over full history).
- Meta Model API client: typed, retries with backoff (honours Retry-After), timeouts, a cost log line per call with no
  content in it, and a hard daily spend cap that reserves each call's worst case before sending it.
- Structured-output tasks (`runTask`): zod schema sent as a strict JSON schema, a code check, and one retry with the
  problem stated.
- zod schemas for what Muse Spark extracts from each input type (Testudo schedule, syllabus page, whiteboard,
  handwritten notes), each item with an exact quote and a box as evidence.
- SAM 3.1 client and box parser.
- Synthetic fixtures (made-up schedule screenshot, pasted schedule text, two-page syllabus PDF).
- First live calls: text, Testudo screenshot (6 of 6 class meetings read from the list view, with boxes), syllabus page
  as a rendered image and as a native PDF (9 of 9 items each), and SAM. Six calls, about 5 cents.
- Guardrails: gitleaks pre-commit hook, a check that fails if any `.env` file other than `.env.example` is tracked.

### Oct 29

- Date and time resolver in code: "Week 7 Thu", "Fri Oct 30", "11/3", "Mon", "today", "in class", "1:00-2:15pm",
  with US daylight-saving tests. Ambiguous words become one question; nothing is guessed.
- Extraction tasks for all four input types, each checked so every date and time the model returns is inside its
  quote, plus an independent second read of every photo crop.
- Verifier: per-field status (verified, needs question, unverified, conflict), "in class" times filled in from the
  schedule, exams that overlap another course's class flagged.
- Cross-source merge with contradiction detection: when sources disagree ("Quiz 3, Fri Oct 30" in the syllabus,
  "Quiz moved to Mon!" on the whiteboard), the item is marked conflict, both pieces of evidence are kept, and one
  question asks which is right, with the likely answer pre-selected and the reason shown.
- Date audit behind "invented dates: 0": every date must trace to words in its quote and recompute to the same value.
- Ten synthetic fixtures (schedule screenshot, grid-only screenshot, pasted schedule, two syllabi, two whiteboards, two
  pages of notes, sticky notes), two with deliberate conflicts, and eleven eval cases.
- First eval run on Muse Spark: 0 invented dates of 74, 73% of everything found fully verified (the rest are real
  questions), 68 of 68 items found, 54 of 54 dates right, 4 of 4 conflicts caught with the right answer
  pre-selected, 0 false conflicts. About 17 cents.
- SAM 3.1 spike: it finds sticky notes, whiteboards, and sheets of paper in a photo, not handwriting.

### Oct 31

- The Lens app at [lens.bettertmrw.app](https://lens.bettertmrw.app): add photos, PDFs, or pasted Testudo text (several
  at once), or try the built-in sample week. Each input is read with Muse Spark (and SAM 3.1 on photos), one page per
  request. The source viewer switches between inputs and PDF pages and highlights every quote on the image; the
  selected item is drawn strongest, with its SAM outline. Every item and class has a status badge, a "computed from"
  line ("\"Week 7 Thu\": week 1 is the week classes start (Mon Aug 31)"), and how its reading was checked.
- One question at a time, with the likely answer pre-selected and its reason shown; a conflict shows both sources'
  words side by side. "They're two different items" keeps both. Edit, leave out, and undo from the list.
- Breaks: class meetings inside a break the syllabus lists are skipped; if none does, Lens asks once.
- Send to Tomorrow (verified items only, after the date audit), and the contract for Tomorrow's side:
  [docs/IMPORT_CONTRACT.md](docs/IMPORT_CONTRACT.md).
- Photos and PDF pages are prepared in the browser and never stored; readings are cached for a day, encrypted with a
  key only the same image can produce. Per-visitor rate limits on top of the daily spend cap.
- Evals: 82% fully verified (was 77%), 0 invented dates of 181, classes 24 of 24, items 75 of 75.

### Oct 30

- SAM 3.1 in the pipeline: each whiteboard and notes photo is segmented into sticky notes, sheets, and the board.
  Every item is attached to the object its quote sits in, and the object's outline is its evidence highlight. The
  second read uses the object's crop when the quote is alone on it, or the quote's line clipped to the object when
  it isn't. Masks are decoded with Meta's `@meta-sam/parser`.
- Evals now report everything with and without SAM, from the same first read, plus model cost per photo, tokens per
  call, and cache hit rate. On the synthetic photos SAM changes no verification result (77% fully verified both
  ways, 0 invented dates of 159), puts 23 of 23 photo quotes in an object, and costs $0.0069 more per photo.
- One targeted retry when a line's crop doesn't read back as its quote: a taller band around it. On the synthetic
  photos that took unverified items from 5 to 0.
- Dates relative to another item: "before Midterm 1", "the day after Quiz 3", "one week after Exam 2". They're
  computed from that item's date and stay linked to it, so answering the Quiz 3 conflict moves Quiz 3 corrections
  from Oct 31 to Nov 3. There's one question only when the item can't be found, or could be more than one.
- Class recurrences end on the last day of classes (RRULE UNTIL, in UTC) when a syllabus or schedule gives it, with
  one question when nothing does.
- Answering questions works in code for conflicts and "which item", and dependents are recomputed after each answer.
- `pnpm eval:real` runs the same evals on my own photos, kept out of the repo in `local-inputs/`.
- Cost–quality policy written into CLAUDE.md and the plan's new Quality bar. As part of it: a failed check retries
  at one step higher reasoning effort, requests carry a prompt-cache key, and evals never re-read an unchanged input.
