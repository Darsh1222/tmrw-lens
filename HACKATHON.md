# Hackathon log

**Tomorrow Lens**, for the Meta Global AI Developer Hackathon. **Track: Build for Your World.** Build window Oct 27 to
Nov 4, 2026. Everything in this repository was written during the hackathon, solo with AI coding assistance (Claude
Code). Live: [tmrw-lens.vercel.app](https://tmrw-lens.vercel.app).

Meta models used: Muse Spark (`muse-spark-1.3`, Standard mode) for reading, re-reading, classifying photos, and the
rebuild agent; SAM 3.1 (`sam-3.1`) for outlining notes, sheets, and boards. Both through Meta Model API.

## The Tomorrow integration

Lens connects to Tomorrow, a separate planning app I built before the hackathon. Tomorrow is not part of this
repository or this submission; only its side of three small HTTP contracts was added during the build window. Lens
talks to it only through them:

- **Send** (`POST /api/lens/import` on Tomorrow, [docs/IMPORT_CONTRACT.md](docs/IMPORT_CONTRACT.md)): verified items
  from Lens become Tomorrow's classes, exams, and deadlines, with their evidence. Each person connects with a Lens token
  from Tomorrow's Settings.
- **Rebuild** (`POST /api/rebuild` on Lens, [docs/REBUILD_CONTRACT.md](docs/REBUILD_CONTRACT.md)): when a planned
  session passes undone, Tomorrow texts a check-in; with the reply, it asks Lens what to move. Lens returns the diff and
  the one recovery text, and Tomorrow applies it and sends the SMS.
- **Text a photo** (`POST /api/extract` on Lens, [docs/EXTRACT_CONTRACT.md](docs/EXTRACT_CONTRACT.md)): a photo texted
  to Tomorrow (a whiteboard saying "quiz moved to Mon") is read by Lens; new items and changes come back with a review
  link, and nothing changes until the person answers.

**The real SMS loop, end to end:** _clip link to be added_.

Per-person spend limits and two global brakes keep the public demo from using Tomorrow's budget (README, Limits).

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

### Oct 31

- The Lens app at [tmrw-lens.vercel.app](https://tmrw-lens.vercel.app): add photos, PDFs, or pasted Testudo text (several
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
- The flagship, miss and rebuild: `POST /api/rebuild`. When a planned session passes undone, Tomorrow sends the plan
  and the person's reply; Muse Spark, with tools (get_day, find_open_time, move_item, drop_item, propose_diff),
  decides what moves or drops and why, and Lens sends back the diff and one message: "Moved Calc practice to 7:30am
  tomorrow because you said tonight is out and it's the last free time before the quiz. Nothing else changed." Code
  computes all free time, refuses any move that doesn't fit, and writes the times. If the model can't answer, code
  places the session in the first free time, so Tomorrow always gets an answer. Contract for Tomorrow's side, with
  miss detection and the check-in: [docs/REBUILD_CONTRACT.md](docs/REBUILD_CONTRACT.md).
- Rebuild evals (in CI): 10 of 10 cases right (code alone gets 5), 0 invalid moves, 0 unkind messages, judge score 5.0
  of 5, $0.0069 and about 5 seconds per rebuild.

### Nov 1

- The missed-session panel, redesigned in Tomorrow's "Forum" look (parchment and ink by day, navy and ivory by night,
  one crimson accent, a pastel per course): a week grid with a compressed time axis, classes quiet, sessions in their
  course's colour, deadlines as flagged lines, and a Now line. One click plays it: the missed block turns into a dashed
  ghost, Tomorrow checks in and the reply lands, Lens's steps stream in ("Found open time: Thu 7:30–9:30 AM"), a path
  draws and the session glides to its new slot, "changed 1 · unchanged 7" ticks up, and the recovery text arrives.
  Before/After toggle, a phone-style thread, code's checks as chips, and a day-by-day timeline on phones. Reduced
  motion shows the final state with no animation. Fixed: the week now shows the plan after the change (the moved
  session at its new time, a ghost at the old), with a test for every recorded rebuild.
- Shortened sessions now say why accurately ("it's the longest free stretch before the midterm"). Rebuild evals: 11
  of 11 right, judge 5.0, $0.0076 per rebuild.

- **Try a missed session** on the homepage, right after the sample week: the flagship without needing Tomorrow. Pick a
  case ("too tired tonight", "practice until 9", sick today, no room, a reply that gives orders…) and see the
  check-in, the reply, the one recovery message, what changed and why, code's check, and every tool call Muse Spark
  made. Recorded runs replay for free; "Rebuild it live" runs Muse Spark on whatever reply you type (a few runs per
  visitor, within the daily spend cap).
- The missed-session panel is now one click: the made-up week, the session struck through, the check-in and reply,
  Muse Spark's tool calls appearing one by one, then what changed and why ("changed 1, unchanged 2") and the recovery
  text. It runs the agent live; the same reply again comes from Lens's cache, free; if a live run isn't possible, the
  recorded run plays and says so.
- Text a photo: `POST /api/extract` for Tomorrow ([docs/EXTRACT_CONTRACT.md](docs/EXTRACT_CONTRACT.md)). Send the
  photos someone texted and their existing items; get back what's new (only verified items auto-apply), what the photo
  changes ("whiteboard says Quiz 3 → Mon Nov 2", applied only once they answer), one question per ambiguity, and a
  signed review link that lasts 24 hours. Course-site screenshots (Canvas, ELMS) are a new kind of input. A blurry
  photo gets a request for a sharper one, never a guess. Evals: 9 of 9 auto-applied items right, recall 100%, 0
  invented dates, 2 of 2 changes caught, $0.016 per photo.
- A new case from trying the live demo: "I have practice until 9 tonight" was read as "tonight is out". Busy-until
  replies now rule out only the time before; that case moves the session to 9pm, and reasons must say what the person
  actually said. Rebuild evals: 11 of 11 right, 0 invalid moves, 0 unkind messages, judge 4.73.

### Nov 3

- Rebuilds pick times like a thoughtful friend would. How much "sooner" matters depends on urgency: due within 30
  hours (or little time left), the soonest good time; otherwise quality wins (their study time, a lighter day, a day's
  buffer, spread out, not right after the miss, never the morning of another quiz). Realistic student defaults when
  Tomorrow sends no preferences: asleep 12:30 to 8:30, study 9am to 11pm (7:30am for a morning person, 12:30am for a
  night person). Reasons are code's words from facts it checked: "Moved Lab report to Thu 12:15pm, right after ENGL101
  seminar with four days to spare." Anything about the reply comes from a note whose exact words code found in it.
  68 cases, 3 runs each: hard rules 100%, best slot 100%, judge 4.84, and a new "would a thoughtful friend pick this
  time?" judge at 4.89.
- Sessions spread out instead of stacking (30 minutes apart at least), with room to breathe around classes (15
  minutes either side); reasons read like a person, at most two facts ("a clear morning, six days before it's due"),
  and "no quiz that day" only when a quiz is near. When nothing fits, the 15-minute offer can use any awake time, since
  the person decides; Lens's own moves stay in study hours.
- Last rebuild fixes before the freeze. The agent is told the sleep and study hours the rules actually use (Tomorrow's,
  or the student defaults, marked assumed), not an old 11pm guess. Offers try study hours first ("a 15-min version at
  10:45pm", not 11:15pm). "The only", "the soonest", "the last", "the longest", and "a lighter" are said only when code
  checked them true of that exact time; anything else is refused. 68 cases, 3 runs each: hard rules 100%, best slot
  100%, judge 4.95, best time 4.98. Rebuild logic is now frozen until after the submission.
- Correction to Nov 2: classes can be shorter on some days. The real MATH141 lecture is 3:00-4:15 Monday and
  Wednesday but 3:00-3:50 Thursday, so Thursday's 3:50 was right. A block's edge now stands unless a popup actually
  lies over it (the block's colour runs, in shadow, straight into the panel); a tooltip 10 minutes below, with page
  between, changes nothing. A covered edge is never filled in from another day: that class's time is asked about. The
  real screenshot reads Thursday 3:00-3:50 again. New synthetic fixture with a short Thursday and a tooltip under it:
  6 of 6 classes right; the popup fixture: Tuesday 11:00-12:15, Thursday asked. Classes right 43 of 43.
- Syllabi say more than dates. Lens now reads, from the syllabus itself: "in-class" exams (timed from that day's
  lecture, labelled "time inferred from your lecture schedule", with both quotes), tentative dates (a later source's
  date is pre-selected, and the question says the syllabus called them tentative), a TBA final (kept undated, with a
  note to check back near the last week), a notice rule ("at least one week (7 days) in advance": an optional task
  before each exam, "Wed Nov 11 (Exam 2) - 7 days = Wed Nov 4", moving with the exam), quizzes "in discussion" (one
  question: which section; its meetings become quiz days, never invented dates), office hours (added only if you say
  yes), and grade weights and topics (kept as course info for study plans). On a real MATH141 syllabus: both exams at
  3:00-4:15 PM, tentative; final TBA; notices Sep 23 and Nov 4; 0 invented dates. New synthetic fixture with the same
  patterns: 6 of 6 items, 0 invented. Extraction evals: no regressions (71% fully verified, 0 of 201 dates invented).

### Nov 2

- Animations only run while you can see them. Each animated element (the hero's preview, SAM's outlines, the plan's
  cards, the missed-session demo) starts once 60% of it is in view, or, if it's taller than the screen, once it fills
  half of it; it pauses when you scroll away and resumes from the same step, and offers Replay when done. Nothing
  autoplays unless it's already in view at load; reduced motion shows the final state. Playwright checks this at
  phone and desktop width, with layout shift under 0.001.
- Rebuilds held to a safety bar. Hard rules in code that the agent can't break and a finished rebuild is checked
  against again: no overlaps with classes, sleep, quiet hours, or other sessions; after now, before the deadline;
  never within 90 minutes of the miss (unless due within a day); never within an hour of bedtime; the text's times are
  exactly the moves'; "Nothing else changed" is true. Placement is ranked by code (sooner, lighter day, their study
  time, not late, not cramming), and every "soonest / last / only / lightest" in a reason is checked true. 68 cases
  from everyday life, 3 runs each: hard rules 100%, best slot 98.9% (top 3: 100%), 68 of 68 pass, judge 4.90, $0.007 a
  rebuild. Tonight's live bug (a 9:30pm miss moved to 10:30pm the same night) is case 1 and can't happen again.
- An owner bypass for running the live demo and the SMS loop: with `OWNER_KEY` set, `/owner?key=…` sets a signed
  httpOnly cookie that skips the per-visitor and per-address limits. The owner's calls still count toward the $5
  public brake and are logged as `owner`.
- A popup left open over a Testudo grid no longer cuts a class short: when a dark panel or its shadow starts just past
  a block's edge, that edge is taken from the same class on another day. On the real screenshot, Thursday's 3:00-4:15
  lecture now reads 3:00-4:15 (it read 3:50). New synthetic fixture with a popup: 6 of 6 classes right.
- A demo "dorm wall" fixture: a cinder-block wall with a small whiteboard, fifteen sticky notes, and the corner of a
  printed schedule, all made up. Lens finds 18 of 18 items with 16 of 16 dates right and 0 invented; 15 verified,
  and the other 3 are honest questions ("quiz 4 in class": what time?). SAM 3.1 outlines every note and the board.
- SAM now runs alongside the first read instead of after it, so a photo's wait is the slower of the two. The source
  photo gets the wider column on the results screen.
- A judge-facing README (pitch, 10-second demo, how Muse Spark and SAM 3.1 are used, "models propose, code verifies",
  results, privacy, architecture), and this log sorted by date with the Tomorrow integration up top.

- A Testudo grid whose blocks show no times now works: Muse Spark reads each block and the hour labels down the side,
  and code measures them in the pixels (each block's exact top and bottom edge, each label's grid line), then works out
  the times from where each block sits, to the nearest 5 minutes. They stay "needs a look" until you confirm them in
  the one question for that screenshot, which lists every class's days and times. On a real Testudo screenshot: 9
  classes found, 9 with times. Synthetic evals: classes right 30 of 30 (was 26), 0 invented dates.

- Spend limits per person, not just one shared cap. Every model call is charged to someone: a Tomorrow user (by
  Tomorrow's opaque id, hashed) gets 30 calls and $0.50 a day; a visitor to the public demo (a signed cookie and their
  address, hashed) gets 25 calls and $0.40. Behind those, two global brakes: $5 a day for the public demo and $20 for
  Tomorrow's users, so demo traffic can never use up Tomorrow's budget. Anything answered from the cache is free and
  never counts. Past a limit, visitors see "Come back tomorrow; the sample week is always free", and Tomorrow gets
  `user_limit` or `global_limit` so it can use its own code-only rebuild. A Tomorrow request without a user id still
  works, charged to one shared Tomorrow identity under Tomorrow's brake. The cost log adds who paid (hashed) and their
  total so far today.

- Every screen in Tomorrow's Forum look, light and dark: a hero ("Your week, read, verified, and rebuilt when life
  happens.") with a small week where a missed session glides to its new slot; a drop zone with honest progress
  ("Reading page 2 of 6… 4s"); results where SAM's outlines draw onto the photo one by one before the plan's cards
  arrive; the plan as a week grid or the whole semester, each item in its course's colour with a "Verified" or "Needs
  a look" chip; and a proof drawer with the crop, SAM's outline, the exact words, and the date math. Plus an evals
  page, and calm error, empty, rate-limit, and not-found states. Lighthouse 93 to 100 on every score, layout shift 0.

- Recovery texts fit one SMS (160 characters, plain characters), checked by a test. When nothing fits before a
  deadline, Tomorrow asks instead of dropping: "No free time before Quiz 3. Want a 15-min version at 7:15am tomorrow,
  or skip it?" When someone says they're sick: "Feel better. Moved Calc practice to 8am, Essay outline to 2pm and Read
  HIST ch. 4 to 3pm tomorrow. Nothing else changed." Every rebuild message is now human-reviewed.
