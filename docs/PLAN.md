# Tomorrow Lens: Meta Global AI Developer Hackathon (build Oct 27-Nov 4, submit Nov 4 ~2 PM ET)

Track: Build for Your World. Rules: public repo, only hackathon-built work shown and clearly identified, must genuinely use Meta models. Avoid looking like a "simple image analyzer" or "AI education chatbot": this is an agentic planning system with verification and follow-through.

## MVP (must ship)

1. Multi-input capture, several at once: Testudo weekly-schedule SCREENSHOT (UID cropped; pasted text as fallback), multi-page syllabus PDF, whiteboard photo, handwritten notes photo.
2. Verified extraction (Muse Spark): classes (recurring blocks), deadlines, exams, tasks. Each extracted field carries evidence; dates/times computed in code; conflicts with class blocks flagged; one question per ambiguity; duplicates merged across sources ("Quiz Fri" on whiteboard = "Quiz 3, Oct 30" in syllabus).
3. "Here's what I found" card with evidence highlights on the source image/page; confirm/edit; then Send to Tomorrow.
4. Send to Tomorrow: confirmed items are created in Tomorrow; Tomorrow's existing scheduler places study sessions around classes and creates reminders.
5. FLAGSHIP Miss & rebuild: a planned session passes undone -> Tomorrow sends one check-in ("Did calc practice happen?") -> "skipped"/no reply -> Lens /rebuild agent (Muse Spark tool calling) decides what moves/drops with reasons -> returns a diff -> Tomorrow applies it and sends ONE recovery message ("Moved X to Thu 4pm because... Nothing else changed."). No guilt/streak language. Real SMS if 10DLC approves in time; otherwise Twilio WhatsApp Sandbox; app thread always.
6. Live try-able demo at lens.bettertmrw.app: sample inputs built in, uploads allowed, per-visitor rate limit, hard daily spend cap.

Out of scope: voice, open weights, video input, Google Calendar, Muse Image, Tomorrow redesign.

Cut order if behind: (1) SAM -> Spark boxes, (2) fancy UI -> simple list + highlight, (3) cross-source merge. Never cut multi-input, verification, or miss & rebuild.

## Answers to open questions

1. Muse Spark: Meta Model API (dev.meta.ai). Docs say OpenAI-compatible Responses API; third-party guides give base URL https://api.meta.ai/v1 and model IDs like muse-spark-1.3. VERIFY base URL, model ID, and image/PDF input format in the official docs first. Use plain fetch or the OpenAI SDK with baseURL. Render PDF pages to images ourselves anyway (needed for page-level evidence highlights and SAM); send native PDF only if it measurably improves extraction.
2. SAM 3.1: first check whether it's on the Meta Model API. If not, run open weights on Modal (Modal account available; check the license). Uses: (a) segment cluttered whiteboard/handwriting images into regions for per-region extraction, (b) tighten evidence highlights. Time-box SAM to 3 hours; fallback = Spark-returned bounding boxes.
3. Evidence = both: {source_id, page (for PDFs), bbox normalized 0-1, quote (exact text)}. Each field has status: verified | needs_question | unverified. Verification: quote re-read on the crop by a second Spark call, dates resolved in code (term start + "week 7 Thu" etc.), conflict check vs class blocks. Unverified fields show amber, are excluded from Send until the user edits/confirms.
4. Testudo: screenshot of the weekly grid (text list view if visible wins over reading grid positions). Pasted text export as fallback input.
5. Send to Tomorrow contract (Tomorrow side built by the owner). Suggested: POST https://bettertmrw.app/api/lens/import with Authorization: Bearer <per-user Lens token generated in Tomorrow Settings>, Idempotency-Key header, payload {items:[{kind: class_block|deadline|exam|task, title, course, start/end or due (ISO + tz), recurrence (RRULE for classes), evidence_ref}]}, response {created_ids, skipped_duplicates}. Rebuild direction: Tomorrow's dispatcher detects a miss and calls Lens POST /api/rebuild (shared secret) with {day_state: items, fixed blocks, open windows computed by Tomorrow, missed_item, user_reply}; Lens returns {diff:[{item_id, action: move|drop|keep, new_time?, reason}], message}; Tomorrow validates every move against its own availability before applying.
6. Persistence/hosting: Lens is stateless for user data. Tomorrow owns the plan. Uploads go to Vercel Blob with auto-delete after 24h; extraction results cached by image hash. Rate limit + daily spend cap counters in Upstash Redis (free tier) or Vercel KV. No database. Host on Vercel at lens.bettertmrw.app (public repo, so Actions/CI are free).

## Public repo rules

No secrets (META_API_KEY in .env.local), gitleaks pre-commit + GitHub push protection, synthetic fixtures only (real images stay in a gitignored local folder), HACKATHON.md dated "what's new" log from the first commit, architecture diagram, "built solo with AI coding assistance". Apache-2.0.

## Schedule

- Oct 28: scaffold, Meta client (typed, retries, timeouts, cost log, daily cap), smoke tests (text, image, PDF page), SAM availability check, zod schemas for all four input types.
- Oct 29: extraction tasks + verifier (quotes, dates in code, conflicts) + cross-source merge; 10 fixtures; SAM spike (3h max).
- Oct 30: Lens UI (multi-upload, page/image switcher with highlights, items with badges, one-question flow); deploy lens.bettertmrw.app; spec the /api/lens/import contract for the Tomorrow side.
- Oct 31: /api/rebuild agent (Spark tool calling: get_day, find_open_time from Tomorrow's provided windows, move, drop-with-reason, propose diff) + evals; spec Tomorrow's miss detection + check-in hook.
- Nov 1: end-to-end live (inputs -> Tomorrow -> reminder -> miss -> rebuild message); fix.
- Nov 2: polish, demo mode, caps, rehearse 10x, README/HACKATHON.md.
- Nov 3: 3-min video + write-up + X post.
- Nov 4: final secret scan, submit by ~2 PM.
