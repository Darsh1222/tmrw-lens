# Decisions

One dated line per judgment call that docs/PLAN.md doesn't cover: what was decided, why, and what was rejected.

- 2026-10-28: Meta Model API facts, checked in the official docs (dev.meta.ai, Markdown versions via `/llms.txt`) and
  then by live calls: base URL `https://api.meta.ai/v1`, `POST /responses`, Bearer key; models `muse-spark-1.3` and
  `sam-3.1` (SAM 3.1 is on Model API, so the Modal fallback in PLAN isn't needed). Images go in `input_image.image_url`
  as a public URL or a base64 data URL; PDFs go in `input_file.file_data` (data URL) with an optional `filename`.
  Structured output on Responses is `text.format` (not `response_format`); reasoning is `reasoning.effort`, and Muse
  Spark rejects `"none"`.
- 2026-10-28: Standard mode only. `-contributor` models are about 12 times cheaper but let Meta train on the prompts
  and files sent, and Lens sends visitors' own schedules. Rejected Contributor mode, even for the demo.
- 2026-10-28: Plain `fetch` for Meta Model API, not the OpenAI SDK with `baseURL`. The client is about 200 lines,
  needs exact control over retries, the spend cap, and logging, and the SDK's types don't know Meta's extra fields.
- 2026-10-28: The env variable is `META_API_KEY` (as in PLAN), not `MODEL_API_KEY` as in Meta's examples.
- 2026-10-28: Spend cap. Each call reserves its worst case (text length / 3 + 3,000 tokens per image + 60,000 per
  native PDF + `max_output_tokens`) before it is sent and settles to the real cost after, so concurrent calls can't
  overshoot. Cap days are UTC days. Default cap $5. When deployed (`VERCEL_ENV` production or preview) without Upstash,
  model calls are refused rather than falling back to a per-instance counter, which wouldn't be a cap. A call that
  fails with no usage is recorded as $0, even though a timed-out call may still be billed by Meta.
- 2026-10-28: Image tokens. The docs don't state them; a 1600×1000 screenshot measured about 2,500 input tokens, so
  the 3,000-per-image estimate is safely high. Revisit with phone photos.
- 2026-10-28: Muse Spark reports positions on a 0–1000 grid (docs: "perception grounding"). The model returns that;
  code converts to the 0–1 boxes in PLAN's evidence shape. A zero-area or inverted box becomes `null`, not an error.
- 2026-10-28: The model returns dates, days, and times exactly as written (`date_text: "Week 7 Thu"`,
  `days_text: "TuTh"`). Each item carries one evidence quote for its row, and every `*_text` field must appear inside
  that quote. That check, and date resolution, are code (Oct 29). Rejected per-field quotes and boxes: three or four
  times the output tokens for the same proof.
- 2026-10-28: PDFs. Both paths work on the synthetic syllabus (9 of 9 items each). The native PDF read the term start
  from page 1 in the same call but cost about twice the input tokens. PDF pages are still rendered to images by Lens
  (in the browser for the app; `scripts/lib/render-pdf.ts` in Node for fixtures and evals), because evidence highlights
  need a page image and a box on it. Revisit native PDF only if per-page extraction misses things.
- 2026-10-28: SAM 3.1 segments objects, not text. On the schedule screenshot, "table", "text", "text block", "word",
  and "box" returned no matches, while "colored rectangle" returned 18 boxes. So SAM's job is likely splitting
  whiteboard and notes photos into regions by physical things (board, sticky note, sheet of paper), not finding
  lines of text. That is the question for the Oct 29 spike (3 hours max).
- 2026-10-28: SAM output is parsed with a small regex for boxes only. Masks aren't used yet, so `@meta-sam/parser`
  isn't installed.
- 2026-10-28: Default reasoning effort for extraction tasks is `low`. The schedule screenshot used about 1,000
  reasoning tokens at that level and got everything right.
- 2026-10-28: Dev-only dependencies for fixtures and evals: `pdfjs-dist` + `@napi-rs/canvas` (render PDF pages in
  Node), `pdf-lib` (write the synthetic syllabus), `tsx` (run scripts). Rejected `mupdf`: AGPL, which a public
  Apache-2.0 repo shouldn't pull in.
- 2026-10-28: The pre-commit hook refuses to commit when gitleaks is missing, rather than skipping the scan. CI also
  runs gitleaks over the full history on every push and pull request.
- 2026-10-29: Contradiction detection (PLAN updated). Two readings are the same item when course, kind, and family
  ("quiz", "pset", "project") match and either their numbers match ("Quiz 3" = "Quiz 3") or one has no number and
  the dates match. An unnumbered reading that says it changed ("Quiz moved to Mon!") joins the next numbered item of
  its kind on or after the day the photo was taken; that join is uncertain, so its question adds "They're two
  different items". Any disagreement on date or start time makes the item `conflict`: no date or time is picked, every
  version keeps its own evidence, and one question lists the versions. Pre-selection: a source that says it changed
  scores 2, a dated photo of a whiteboard or notes scores 1, the highest wins, and with no score the syllabus wins as
  the official schedule. The reason is always shown ("The whiteboard photo was taken Wed Oct 28 and says 'moved to'").
  Only conflicts are pre-selected; a plain date choice ("Thu" written on a Thursday) has no favourite, so none is.
- 2026-10-29: "Invented dates" is an audit, not a model judgement. Every date in a plan (term start, item dates,
  class first meetings, every version in a conflict) carries a trace: the words, the quote they're in, the rule, and
  the inputs. The audit checks the words are in the quote, the inputs are the plan's own term start or the source's
  photo or added date, and that recomputing gives the same date; times likewise. Send will run it and refuse on any
  failure. "Fully verified" counts classes and items whose every field is `verified`.
- 2026-10-29: Date resolution rules. Week N is counted from the Monday-to-Sunday week the term starts in. A month and
  day without a year take the year that puts them from 60 days before to 305 days after the anchor (term start, else
  photo date, else the day the source was added). "Mon", "today", and "tomorrow" need a photo date, and "Mon" written
  on a Monday or "next Mon" is a question. A weekday that disagrees with its date ("Fri Oct 31") is a question.
  "midnight" is 11:59pm on that day. A time without am/pm ("5") is a question. "in class" takes the course's meeting
  that day from the schedule, preferring the lecture.
- 2026-10-29: Verification by source type. Pasted text and PDF pages with a text layer: each line of the quote must be
  found in the text (quotes may join non-adjacent lines, like a course heading and its meeting). Photos: a second Spark
  call re-reads crops of every box, with no hint of the first reading; the quote must match (each line, or 85%
  similar) and every field must appear in the re-read exactly, so a changed digit fails. On a grid-only Testudo
  screenshot, class days come from column positions, which no quote can prove, so the days are one question per
  screenshot rather than verified or unverified. Rejected re-reading text-layer PDF pages: search is stricter and free.
- 2026-10-29: Crops for the re-read are padded by 5% of the image width: Spark's boxes were sometimes a character
  short, and the first eval run lost the "5" of "11/5".
- 2026-10-29: Evals replay recorded model readings (`evals/recorded/`, keyed by fixture hash and task version), so
  `pnpm eval` is free and runs in CI; `pnpm eval:live` re-reads the fixtures (about 17 cents for all 10). Fixtures are
  byte-identical across regenerations (PDF dates pinned, seeded noise) so recordings don't go stale.
- 2026-10-29: Synthetic whiteboard, notes, and sticky-note photos are drawn in code with two SIL Open Font License
  handwriting fonts (Caveat, Patrick Hand), vendored in `fixtures/fonts/` with their licences, plus rotation, uneven
  light, and noise. Real photos are still needed before the demo; they stay in `local-inputs/`.
- 2026-10-29: SAM spike (about 20 minutes, under 2 cents). On the synthetic photos SAM 3.1 finds each sticky note
  ("sticky note", 0.97), the whole whiteboard, and the sheet of notebook paper, but nothing for "handwriting". It also
  boxed a laptop corner as a sticky note at 0.91. Spark already read all four sticky notes from the whole photo, so
  SAM isn't in the pipeline. Revisit with real cluttered photos: split by "sticky note" or "paper" at confidence 0.95
  or more, and read each region on its own.
- 2026-10-29: `@napi-rs/canvas` moved to runtime dependencies: the server crops boxes for the re-read.
