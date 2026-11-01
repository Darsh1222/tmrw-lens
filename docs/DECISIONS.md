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
- 2026-10-30: The cost–quality policy lives in CLAUDE.md and in PLAN.md's new "Quality bar" section. Lens has no
  SPEC; PLAN is its spec. Tomorrow's `docs/SPEC.md` (its section 11 is the "Quality bar") is read-only from here, so
  the owner adds it there. Points that only exist in Tomorrow (SMS, admin, judge score, MODEL_FAST/MODEL_SMART) are
  kept as written, with a note on how each applies to Lens.
- 2026-10-30: Policy point 3 in Lens: there is one text model, so tasks route by reasoning effort (`minimal` for
  re-reads, `low` for extraction), and `runTask`'s one retry after a failed check runs one effort step higher. The
  cost log tags it `:retry`, which is what the escalation rate is counted from. Point 4: Meta Model API caches
  prefixes automatically; instructions go first and `prompt_cache_key` is the task name (never content). Point 8:
  Meta documents no Batch API, so nothing is batched yet.
- 2026-10-30: SAM masks are decoded with Meta's `@meta-sam/parser` 0.1.0 (SAM License: free use and redistribution,
  with the licence included if it's ever distributed). It runs on the server only, and only outlines, never the
  library, reach the browser. A regex can't parse masks: the base85 payload can contain `|>`.
- 2026-10-30: SAM in the pipeline. Each whiteboard and notes photo gets three SAM calls ("sticky note", "paper",
  "whiteboard", since SAM takes one concept per request): $0.0075 per photo. Matches under 0.5 confidence are dropped.
  The raw detections are recorded; which ones are the same thing is decided in code. Detections whose boxes overlap
  by IoU over 0.8 count as one object, and the likelier label wins, then the more specific one on a near-tie, so a
  notebook page found as "sticky note" at 0.73 and "paper" at 0.93 is paper. A quote belongs to the smallest object
  whose outline holds the centre of its box. The outline is the convex hull of the mask, in 0-1 image coordinates,
  stored on the evidence as `region` and used as the highlight.
- 2026-10-30: Which crop the second read gets. A quote alone on its object (one item per sticky note) is re-read from
  the whole object, with everything outside its outline painted white. A quote that shares its object (a line on a
  board or a notebook page) is re-read from its own box, clipped to the object's outline. Tried and rejected:
  re-reading a shared object whole. It scored higher (77% fully verified against 72%), but on a board or a page the
  object is nearly the whole photo, so that "second read" is the same pixels as the first. The gain came from
  papering over badly placed boxes, which is a weaker check, not a better one.
- 2026-10-30: One targeted retry for a line crop that doesn't read back as its quote (the model's box was a line off,
  or cut a digit): a band 1.5 box heights above and below, as wide as the object (or the photo, without SAM),
  clipped to the object. This follows policy point 9, a cheap check before anything bigger. On the synthetic photos
  it recovered every such line: 0 unverified items, up from 5. A re-read still never sees the first read's text.
- 2026-10-30: The second read's quote match also accepts 85% similarity to any stretch of the re-read about the
  quote's length, not only to the whole re-read, because an object or band read holds more than one line. Fields
  still have to appear in the re-read exactly, so a changed digit still fails.
- 2026-10-30: SAM stays on for photos. On the synthetic photos it changes no verification result (77% with and
  without; the second reads came back identical) and costs $0.0069 more per photo ($0.0185 against $0.0116). It is
  kept for the outline highlight (every photo quote lands in an object) and for keeping neighbouring notes out of a
  crop, which the clean synthetic photos don't test. `readSource(..., { sam: false })` turns it off. Real photos
  decide whether its second-read crops are worth keeping.
- 2026-10-30: Relative dates. "before X" and "by X" mean X's date, and X's start time when X has one (due before it
  starts). "the day/week before/after X" and "N days/weeks before/after X" add or subtract days. A bare "after X"
  isn't a date. "the day before Oct 30" is computed directly. The item X is looked up among items of the same course:
  by kind and number ("Midterm 1"), by kind alone when only one exists ("the project" with one project), or by exact
  title. If none matches, or more than one does, there's one "which item" question, listing the candidates. A
  dependent of an item with no date yet (a conflict, say) waits on that item, with no question of its own. Dates are
  recomputed after every answer, in dependency order, and a cycle is a question. The audit checks each dependent
  against its item's current date.
- 2026-10-30: "Quiz 3 corrections", "Midterm 1 review", "Exam 2 corrections" and the like are things of their own,
  not Quiz 3 or Midterm 1, so they don't merge into them. A quote's date words no longer name its item ("review
  slides before Exam 2" isn't Exam 2).
- 2026-10-30: The last day of classes comes from a syllabus or schedule (`term_end` in both extraction schemas). Each
  class's RRULE ends with UNTIL at the end of that day in the person's zone, written in UTC as RFC 5545 asks
  (20261209T045959Z for Tue Dec 8 in New York). Each class also keeps its last meeting on or before that day. With
  classes but no end date there is one question, never one per class, and two sources that disagree make it a
  conflict. Breaks (Thanksgiving) aren't handled yet (they'd be EXDATEs).
- 2026-10-30: Answers apply in code (`answerQuestion`): picking a conflict version settles that item, and choosing
  which item a relative date means links it; then dependents are recomputed. Splitting a "maybe the same" conflict
  into two items ("They're two different items") isn't built yet and throws, for the UI slice to add.
- 2026-10-30: Real photos (`pnpm eval:real`, files in `local-inputs/`). They're prepared the way the app will prepare
  uploads: at most 2048px on the long edge, re-encoded as JPEG (which drops every EXIF field, location included),
  keeping the capture time read from EXIF. `@napi-rs/canvas` already applies EXIF orientation when it decodes. HEIC
  is converted with macOS `sips` (local only). Each file's kind comes from `local-inputs/inputs.json` or its name.
  Recordings stay in `local-inputs/.recorded/`, and only numbers are printed unless `--verbose`. With no gold
  answers, only the two headline numbers are scored, which need none.
- 2026-10-30: Never pay twice in evals. `pnpm eval:live` re-reads only inputs whose recording is missing or stale
  (file hash, task version, or for photos the crop version), and `--force` re-reads everything. Recordings now hold
  both second reads (with and without SAM) from one first read, so the comparison differs only in SAM, plus calls,
  tokens, cached tokens, and cost per stage.
- 2026-10-30: Fixture additions: the MATH141 syllabus gains "Last day of classes: Tuesday, December 8, 2026." and
  "Quiz 3 corrections are due the day after Quiz 3." The CMSC131 syllabus gains "Exam 2 corrections due one week
  after Exam 2". The eval cases with the moved quiz answer the conflict and check that the corrections move from
  Oct 31 to Nov 3. All tasks were bumped (schedule v2, syllabus v3, whiteboard v3, notes v3) for the new fields and
  the relative-date rule.
- 2026-10-31: SAM License (checked in `node_modules/@meta-sam/parser/LICENSE`, "SAM License, Last Updated November
  19, 2025"). It grants a non-exclusive, worldwide, royalty-free license to use, reproduce, distribute, and modify the
  SAM Materials, with no field-of-use or user-count limit, so a public repo, the hosted demo, and later commercial use
  are all allowed. Obligations that apply to Lens: anyone who redistributes the SAM Materials must include a copy of
  the license (Lens doesn't vendor the parser; it's an npm dependency, and the deployed server bundle isn't handed to
  anyone); a published write-up of research done with SAM must acknowledge SAM (the README and HACKATHON.md do);
  comply with trade controls and privacy law; don't reverse engineer the models; suing Meta over SAM IP ends the
  license. Calls to `sam-3.1` itself are under the Meta Model API terms, not this license. Not legal advice; revisit if
  Meta changes the license (it says changes take effect on continued use).
- 2026-10-31: Breaks. Syllabus and schedule tasks read `breaks` (name, dates as written, quote); code resolves them
  with `parseDateRange` ("Nov 25-29", "11/25-11/29", "November 25 - 29, 2026"; at most five weeks) and each class
  gets `skip_dates`: its meetings inside a break, within the term. Sent to Tomorrow as `exdates` at the class's own
  start time. If no source lists breaks and there are classes, one question (`q_breaks`: "No breaks" or type the
  dates). The audit recomputes breaks from their words and every class's skipped meetings from the breaks. Tasks
  bumped: schedule v3, syllabus v4. The MATH141 fixture gains a Thanksgiving break line.
- 2026-10-31: A plan is the readings plus the person's answers, replayed in order (`planFrom`, session.ts). Answers that
  change how readings resolve are facts that rebuild the plan: first and last day of classes, when a photo was taken,
  breaks, and "two different items" (those candidates are never merged again). Everything else (picking a version or
  a date, a course, a time, confirming, editing, leaving out) is applied on top after every rebuild; an answer whose
  question a rebuild settled another way is dropped. Item edits and "Leave out" from the list are answers too
  (`edit:<id>`, `skip:<id>`). A date or time the person gives has trace rule `answer`, naming the question; the audit
  accepts it as traced to them rather than to a quote. Rejected: patching the plan in place per answer (fact answers
  change every date downstream; replaying is simpler and can't drift).
- 2026-10-31: Uploads aren't stored, and Vercel Blob isn't used (PLAN said Blob with 24h delete). The browser does what
  Blob was for: photos are turned upright, shrunk to 2048px, and re-encoded as JPEG there (EXIF dropped after the
  capture time is read), and PDF pages are rendered there with pdf.js (at most 12 pages), so every request to
  `/api/read` is one page under 4 MB, inside Vercel's body limit. One page per request also keeps each call well
  inside the function time limit. Less to configure, and nothing of a visitor's to delete. Readings are cached 24h in
  Upstash by content hash (never pay twice), encrypted with AES-256-GCM under a key derived from the image bytes and
  stored under a hash of that key, so only the same image can find or read it.
- 2026-10-31: Rate limit: per visitor (a hash of their IP, never the IP), 40 page reads an hour and 120 a day, counted
  only on cache misses; plus the existing daily spend cap. The sample week replays recorded readings (`pnpm sample`
  writes them from the full-week eval case) and costs nothing.
- 2026-10-31: A Testudo grid can be read one block per column ("Monday" MATH141 10:00, "Wednesday" MATH141 10:00): the
  Oct 31 re-record did exactly that and lost all 6 grid classes. Code now merges grid blocks with the same course,
  type, times, and room into one meeting pattern (every block's quote as evidence, the union of boxes as highlight),
  and the audit checks each day word is in the quote. Back to 24 of 24. Fixed in code rather than the prompt, since
  both readings of a grid are fair.
- 2026-10-31: `eval:live` staleness now checks only the tasks an input is read with. Bumping the syllabus and
  schedule tasks had re-read every fixture (about 13 cents wasted).
- 2026-10-31: SAM's three concept calls per photo run in parallel (results kept in a fixed order, so the outcome
  doesn't depend on timing): about 2.5 s faster per photo.
- 2026-10-31: Send relays through Lens's server rather than the browser calling Tomorrow, so Tomorrow needs no CORS.
  The person's Lens token passes through and isn't stored or logged. The Idempotency-Key is a hash of the body.
- 2026-10-31: Rebuild split: the model chooses (what moves or drops, and the reason, a clause after "because"); code
  owns every fact (free time from Tomorrow's windows plus slots freed by other changes, whether a move fits before its
  deadline, the times in the message) and writes the message itself ("Moved X to Thu 4pm because …. Nothing else
  changed."), so the message always says exactly what the diff does. Reasons with clock times, guilt, praise, urgency,
  or "!" are refused back to the model.
- 2026-10-31: Rebuild tool loop is stateless (`store: false`, reasoning replayed with `reasoning.encrypted_content`), so
  Meta keeps no copy of anyone's plan. Prefix caching still works: 86% of input tokens cached.
- 2026-10-31: Meta's `strict` flag validates tool schemas but not the model's arguments: Spark sometimes leaves out a
  null field, sends `"null"`, a number as a string, or seconds on a time. Code accepts those unambiguous forms; anything
  else goes back to the model as a refusal with the reason. Refusals went from 14 to 0 per 10 cases.
- 2026-10-31: One cheap check before a drop stands: if the agent drops the missed item while time that fits is still
  free before its deadline, propose_diff pushes back once, listing that time. A second propose_diff is accepted (the
  reply may rule the time out). This fixed the one wrong rebuild (dst-weekend dropped despite Sunday being free) without
  raising reasoning effort.
- 2026-10-31: Reasoning effort `low` for the rebuild: 10 of 10 right, judge 5.0, in two full runs; per the cost–quality
  policy, `medium` isn't needed. At most 8 turns and 45 seconds, then code's fallback (first free time before the
  deadline, else drop), so Tomorrow always gets a valid answer; fallback answers aren't cached, so a retry gets the model.
- 2026-10-31: Judge for rebuild messages is Muse Spark itself (one call per case, live evals only, recorded), given the
  facts, all free time, the changes, and the message. Same-model judging may be lenient; the code checks (validity,
  expectations per case, unkind words) are the hard gate, the judge is the soft one.
- 2026-10-31: At most 3 changes per rebuild, the missed item included: past that it's a new plan, not a recovery, and
  "Nothing else changed" stops being the point.
- 2026-10-31: `/api/rebuild` auth is one shared secret (`LENS_REBUILD_SECRET`, at least 32 characters) compared in
  constant time; Tomorrow calls server to server. Same request within 24 hours is answered from the encrypted cache.
- 2026-11-01: "Try a missed session" is the default way to see the flagship, on the homepage right after the sample
  week, not a fallback for Tomorrow: recorded runs (the same ones `pnpm eval:rebuild` scores, written by `pnpm sample`
  to `src/lib/demo/rebuilds.json`) replay free; a live run uses the case's made-up week with only the visitor's reply
  (at most 280 characters), limited to 6 an hour and 20 a day per visitor (separate counters from page reads), within
  the daily spend cap. Past the cap, code's fallback answers and the panel says so. Same case and reply again comes from
  the encrypted cache.
- 2026-11-01: The panel's body renders on the client only (`useSyncExternalStore`): Luxon reads the clock while parsing,
  which Cache Components refuses during prerender. The header is in the static page.
- 2026-11-01: New rebuild case `busy-until` ("I have practice until 9 tonight"), from trying the live demo: the agent
  had treated it as "tonight is out" and said so. Instructions now say busy-until rules out only the time before, and
  reasons must say what the person said. Rebuild version 6.
- 2026-11-01: The judge is the same model as the agent, so the owner spot-checks every recorded rebuild message before
  the README calls them human-reviewed. Run of Nov 1: the judge gave `shorten` a 2 ("only an hour still fits" when 45
  more minutes are free Thursday morning; the hour is the longest stretch), left as recorded for that review.
