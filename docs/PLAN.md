# Tomorrow Lens: Meta Global AI Developer Hackathon (build Oct 27-Nov 4, submit Nov 4 ~2 PM ET)

Track: Build for Your World. Rules: public repo, only hackathon-built work shown and clearly identified, must genuinely use Meta models. Avoid looking like a "simple image analyzer" or "AI education chatbot": this is an agentic planning system with verification and follow-through.

## MVP (must ship)

1. Multi-input capture, several at once: Testudo weekly-schedule SCREENSHOT (UID cropped; pasted text as fallback), multi-page syllabus PDF, whiteboard photo, handwritten notes photo.
2. Verified extraction (Muse Spark): classes (recurring blocks), deadlines, exams, tasks. Each extracted field carries evidence; dates/times computed in code; conflicts with class blocks flagged; one question per ambiguity; duplicates merged across sources ("Quiz Fri" on whiteboard = "Quiz 3, Oct 30" in syllabus). Contradiction detection (added Oct 29): when two sources describe the same item with different dates/times/details (syllabus "Quiz 3 Oct 30" vs whiteboard "quiz moved to Mon"), never merge silently. Mark it "conflict", show both evidence crops side by side, and ask one question with the likely answer pre-selected (the newer handwritten/whiteboard source usually wins), never applied until the person answers. Relative dates (added Oct 30): "before Midterm 1" / "the week after the project" resolve against the referenced item's date and keep a dependency link, so when that item moves (e.g. a conflict answer) its dependents move too; ask only when the referenced item can't be found. Class recurrences (added Oct 30) end at the term's last day of classes when a syllabus or schedule gives it; otherwise ask once. Breaks (added Oct 31): class meetings inside a break a syllabus or schedule lists ("Thanksgiving break: Nov 25-29") are skipped (EXDATEs); if none lists any, ask once. A conflict that may be two different items offers "They're two different items", which keeps both.
3. "Here's what I found" card with evidence highlights on the source image/page; confirm/edit; then Send to Tomorrow.
4. Send to Tomorrow: confirmed items are created in Tomorrow; Tomorrow's existing scheduler places study sessions around classes and creates reminders.
5. FLAGSHIP Miss & rebuild: a planned session passes undone -> Tomorrow sends one check-in ("Did calc practice happen?") -> "skipped"/no reply -> Lens /rebuild agent (Muse Spark tool calling) decides what moves/drops with reasons -> returns a diff -> Tomorrow applies it and sends ONE recovery message ("Moved X to Thu 4pm because... Nothing else changed."). No guilt/streak language. Real SMS if 10DLC approves in time; otherwise Twilio WhatsApp Sandbox; app thread always.
6. Live try-able demo at lens.bettertmrw.app: sample inputs built in, uploads allowed, per-visitor rate limit, hard daily spend cap.

Out of scope: voice, open weights, video input, Google Calendar, Muse Image, Tomorrow redesign.

Cut order if behind: (1) SAM -> Spark boxes, (2) fancy UI -> simple list + highlight, (3) cross-source merge. Never cut multi-input, verification, or miss & rebuild.

## Answers to open questions

1. Muse Spark: Meta Model API (dev.meta.ai). Docs say OpenAI-compatible Responses API; third-party guides give base URL https://api.meta.ai/v1 and model IDs like muse-spark-1.3. VERIFY base URL, model ID, and image/PDF input format in the official docs first. Use plain fetch or the OpenAI SDK with baseURL. Render PDF pages to images ourselves anyway (needed for page-level evidence highlights and SAM); send native PDF only if it measurably improves extraction.
2. SAM 3.1: on Meta Model API (`sam-3.1`, one concept per request, $0.0025 per image). In the pipeline since Oct 30: each whiteboard/notes photo is segmented into objects (sticky note, paper, whiteboard); every extracted item is attached to the object its quote falls in; the object's outline is the evidence highlight; the independent second read runs on the SAM object crop (a quote alone on its object) or on its line clipped to the object (a quote that shares it). Evals report verification with and without SAM, and cost per photo. Fallback = Spark-returned bounding boxes.
3. Evidence = both: {source_id, page (for PDFs), bbox normalized 0-1, quote (exact text)}. Each field has status: verified | needs_question | unverified | conflict. Verification: quote re-read on the crop by a second Spark call, dates resolved in code (term start + "week 7 Thu" etc.), conflict check vs class blocks. Unverified fields show amber, are excluded from Send until the user edits/confirms.
4. Testudo: screenshot of the weekly grid (text list view if visible wins over reading grid positions). Pasted text export as fallback input.
5. Send to Tomorrow contract (Tomorrow side built by the owner). Specified in [IMPORT_CONTRACT.md](IMPORT_CONTRACT.md) (Oct 31; items carry a local `date` plus `start_time`/`end_time`, never an invented time; classes carry `exdates`). Original suggestion: POST https://bettertmrw.app/api/lens/import with Authorization: Bearer <per-user Lens token generated in Tomorrow Settings>, Idempotency-Key header, payload {items:[{kind: class_block|deadline|exam|task, title, course, start/end or due (ISO + tz), recurrence (RRULE for classes), evidence_ref}]}, response {created_ids, skipped_duplicates}. Rebuild direction: Tomorrow's dispatcher detects a miss and calls Lens POST /api/rebuild (shared secret) with {day_state: items, fixed blocks, open windows computed by Tomorrow, missed_item, user_reply}; Lens returns {diff:[{item_id, action: move|drop|keep, new_time?, reason}], message}; Tomorrow validates every move against its own availability before applying.
6. Persistence/hosting: Lens is stateless for user data. Tomorrow owns the plan. Uploads (changed Oct 31): photos are shrunk and PDF pages rendered in the browser, and sent one page per request, so nothing needs storing and Vercel Blob isn't used; extraction results are cached 24h by image hash in Upstash, encrypted with a key derived from the image. Rate limit + daily spend cap counters in Upstash Redis (free tier) or Vercel KV. No database. Host on Vercel at lens.bettertmrw.app (public repo, so Actions/CI are free).

## Quality bar

Lens targets, measured by `pnpm eval` (synthetic, in CI) and `pnpm eval:real` (the owner's own photos, local only):
0 invented dates (CI fails otherwise); every deliberate conflict caught with the right answer pre-selected (CI
fails otherwise); 0 wrong dates; "% fully verified" never lower than the last recorded run. Correction rate (share
of fields the person edits before Send) and a judge score for rebuild messages join when the UI and the rebuild
agent exist.

Cost–quality policy (standing; every feature and every prompt or model change follows it; same text in CLAUDE.md):

1. Quality floor first. Eval targets (judge score, verification %, 0 invented dates, correction rate) never go down to save money. Cost cuts only ship if evals show equal or better quality.
2. Code before models. Dates, times, availability, conflicts, math, totals, and formatting are computed in code (free, exact). Models only read, decide, and write.
3. Route by difficulty. Cheapest model that passes evals for each task: MODEL_FAST for classification, safety, simple replies and single adds; MODEL_SMART for multi-item dumps, conflicts, planning trade-offs, rebuilds. Escalate to the bigger model automatically when confidence is low or a check fails, never the other way around. (Lens: one text model, so routing is by reasoning effort; a failed check retries one step up.)
4. Prompt caching on every stable prefix (system prompt, tool definitions, static rules). Report cache hit rate.
5. Small context. Send only what the turn needs (recent messages, today/tomorrow, relevant items), not the whole history. Measure tokens per turn.
6. Cap output length per task; SMS replies stay short by design.
7. Never pay twice. Cache file/image extraction by content hash; don't re-run a model on unchanged input.
8. Batch what can wait (weekly recaps, pattern detection, eval runs) via the Batch API. (Meta Model API has none documented yet.)
9. Checks over bigger models. Prefer a cheap verification step (schema + code checks + one targeted re-read) to upgrading the whole task to a larger model.
10. Measure. Admin shows cost per turn, cost per active user per week, tokens per turn, cache hit rate, fallback/escalation rate, alongside judge score and correction rate. Every PR that touches prompts or models reports before/after on both quality and cost.

## Public repo rules

No secrets (META_API_KEY in .env.local), gitleaks pre-commit + GitHub push protection, synthetic fixtures only (real images stay in a gitignored local folder), HACKATHON.md dated "what's new" log from the first commit, architecture diagram, "built solo with AI coding assistance". Apache-2.0.

## Schedule

- Oct 28: scaffold, Meta client (typed, retries, timeouts, cost log, daily cap), smoke tests (text, image, PDF page), SAM availability check, zod schemas for all four input types.
- Oct 29: extraction tasks + verifier (quotes, dates in code, conflicts) + cross-source merge with contradiction detection; 10 fixtures, 2 with deliberate conflicts; evals reporting two headline numbers for the demo: "% of items fully verified" and "invented dates: 0" (every date traces to a quote + code computation); SAM spike (3h max).
- Oct 30 (first): SAM 3.1 in the pipeline (objects, attachment, outline highlights, second read on object crops; evals with vs without SAM, cost kept in the log); relative dates with dependency links; class recurrences ending on the last day of classes; evals on the owner's real photos (`pnpm eval:real`), reported next to synthetic.
- Oct 30 (landed Oct 31): Lens UI (multi-upload, page/image switcher with highlights, items with badges, one-question flow); deploy lens.bettertmrw.app; spec the /api/lens/import contract for the Tomorrow side.
- Oct 31: /api/rebuild agent (Spark tool calling: get_day, find_open_time from Tomorrow's provided windows, move, drop-with-reason, propose diff) + evals; spec Tomorrow's miss detection + check-in hook.
- Nov 1: end-to-end live (inputs -> Tomorrow -> reminder -> miss -> rebuild message); fix.
- Nov 2: polish, demo mode, caps, rehearse 10x, README/HACKATHON.md.
- Nov 3: 3-min video + write-up + X post.
- Nov 4: final secret scan, submit by ~2 PM.
