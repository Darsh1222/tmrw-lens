# Tomorrow Lens

**Tomorrow Lens turns the messy paper of student life into a verified plan, and rebuilds it the moment life gets in the way.**

> **Frozen: this is the hackathon version** ([`v1.0-hackathon`](https://github.com/Darsh1222/tmrw-lens/releases/tag/v1.0-hackathon),
> everything built Oct 27 to Nov 4, 2026). Lens now continues inside Tomorrow, which is private; this repository
> gets no new features and will be archived.

**Video:** _[demo video link to be added]_ · **The real SMS loop:** _[SMS clip link to be added]_

**Live:** [tmrw-lens.vercel.app](https://tmrw-lens.vercel.app) · Built for the Meta Global AI Developer Hackathon
(track: Build for Your World), Oct 27 to Nov 4, 2026, solo with AI coding assistance. Everything here was built in
the hackathon window ([HACKATHON.md](HACKATHON.md)).

## What's new: built during the hackathon

Only work built during the hackathon is shown as the submission. What existed before, and what was built during it:

|                                             | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | When, and where to see it                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Existed before the hackathon**            | **Tomorrow**: an SMS planning assistant (private, not in this repo) with basic chat, reminders, and sign-up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Before Oct 27, 2026. Not shown as hackathon work.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Built during the hackathon**              | **All of Tomorrow Lens** (this repository): reading syllabi, schedules, and photos with Muse Spark and SAM 3.1; proof for every date; the rebuild agent; text-a-photo; evals; the site.                                                                                                                                                                                                                                                                                                                                                                                                          | Oct 28 to Nov 4, 2026: every commit in this repo, from `08ff8c7` (Oct 28, initial commit) on. Highlights: `68eeec6` model client (Oct 29), `8476773` plan builder (Oct 29), `2041e8f` SAM 3.1 (Oct 31), `51c37ff` UI and import contract (Oct 31), `7909962` rebuild agent (Nov 1), `d1e5624` text-a-photo (Nov 1), `336332f` per-person limits (Nov 2), `591fe84` rebuild safety bar (Nov 3), `55e50f6` syllabus policies and grid (Nov 3). Full log: [HACKATHON.md](HACKATHON.md). |
| **Built during the hackathon, in Tomorrow** | Lens import and Connect (Send to Tomorrow); check-ins after planned sessions; a missed session → Lens rebuild → one recovery text (Lens's words, then "Reply UNDO to undo.", in one 160-character SMS) with the change pinned in the app; text-a-photo via Lens's `/api/extract`; the Best-Time Engine, sharing Lens's scoring for placement, the fallback, and checking Lens's moves; `user_ref` and the code-only rebuild when Lens is over its limits; no links in texts; the accuracy work the loop needed (answers from the record, the truth rule, the intent gate, integrity invariants). | Oct 27 to Nov 4, 2026, in 15 pull requests (#22 to #41) in Tomorrow's private repository; that code isn't published here. Lens's side of each: [IMPORT](docs/IMPORT_CONTRACT.md), [REBUILD](docs/REBUILD_CONTRACT.md), [EXTRACT](docs/EXTRACT_CONTRACT.md).                                                                                                                                                                                                                          |

## Try it in 10 seconds

Open the live site and press **Try a missed session**. A made-up week plays: a study session passes undone, the
student replies "too tired tonight", Muse Spark works out what to move (you see each tool call), the session glides to
its new slot, and the one recovery text arrives: _"Moved Calc practice to 7:30am tomorrow, so tonight can be off, the
soonest it fits before Quiz 3. Nothing else changed."_ The recorded runs are free and never count against a limit; type
your own reply to run it live.

Then step 2, **See the proof**, opens the sample week (free, instant, no limits); or **Upload your own** syllabus,
Testudo schedule, whiteboard photo, or notes. Tap any item for its proof: the photo crop, SAM 3.1's outline, the exact
words, and the date math. When it's right, **Send to Tomorrow**, or **Add to calendar (.ics)** for any calendar app.

## How Meta's models are used

- **Muse Spark** (`muse-spark-1.3`, Standard mode) reads every page and photo into structured items, each with an exact
  quote and a box; re-reads each quote from a crop of where it says it found it; classifies texted photos; and runs the
  **rebuild agent**, a tool-calling loop (`get_day`, `find_open_time`, `move_item`, `drop_item`, `propose_diff`) that
  decides what moves when a session is missed and why.
- **SAM 3.1** (`sam-3.1`) outlines each sticky note, sheet, and whiteboard in a photo, so every line is tied to the
  object it's written on, re-read from that object's crop, and highlighted on it.

## Models propose, code verifies

The model reads; code computes and checks. Nothing reaches the plan on the model's word alone:

- Every field must appear inside its exact quote, and every quote must be read back from its own crop by a second,
  independent call.
- Dates, weekdays, times, "Week 7 Thu", "the day after Quiz 3", class recurrences, breaks, and daylight saving are
  computed in code (Luxon), never by the model. Every date traces to a quote plus a computation.
- Sources that disagree (the syllabus says Fri, the whiteboard says "moved to Mon") are never merged silently: one
  question, the likely answer pre-selected with its reason, applied only when the person answers.
- Anything unproven stays amber ("Needs a look") and is never sent to Tomorrow until the person confirms it.
- In a rebuild, code computes free time, refuses any move that doesn't fit, and writes the message from the agent's
  reasons; a check runs on the finished plan before it can leave Lens.

## Results

Synthetic fixtures only (made up, in `fixtures/synthetic/`), scored offline in CI from recorded model readings:

| What                                  | Result                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Invented dates                        | **0** of 210 (extraction), **0** of 13 (text-a-photo)                      |
| Items found / classes right           | 116 of 116 / 43 of 43; 62% fully verified, the rest asked (never guessed)  |
| Conflicts caught, answer pre-selected | 4 of 4, 4 of 4, 0 false                                                    |
| Rebuilds: hard rules kept             | **100%** of 204 runs (68 cases, 3 runs each)                               |
| Rebuilds: placement (code's oracle)   | top-1 **100%**, top-3 **100%**; 68 of 68 cases pass                        |
| Rebuild message quality (judge, 1-5)  | **4.95**; best time **4.98** ("would a thoughtful friend pick this time?") |
| Cost per photo read / per rebuild     | $0.023 with SAM / $0.0080 (3.7 model calls, about 8 s)                     |

Details and how each is measured: [Evals](#evals) below, and the live [evals page](https://tmrw-lens.vercel.app/evals).

## Privacy

- **Standard mode only:** Meta doesn't train on what Lens sends. Contributor models are never used.
- **Photos are never stored.** They're shrunk in your browser, read, and dropped. What was read is cached for 24 hours,
  encrypted with a key only the same photo can produce, so the same page is never paid for twice; then it expires.
- No accounts, no database: Tomorrow owns the plan. Logs hold counts, costs, and hashed ids, never content.
- Fixtures are synthetic; real inputs stay in a git-ignored folder.

## Architecture

```mermaid
flowchart LR
  subgraph you["You"]
    up["Syllabus PDF · Testudo screenshot<br/>whiteboard · notes"]
  end
  subgraph lens["Tomorrow Lens (Next.js on Vercel)"]
    read["Read<br/>Muse Spark: items + quotes + boxes"]
    sam["Segment<br/>SAM 3.1: notes, sheets, boards"]
    check["Verify in code<br/>re-read each crop · dates in Luxon<br/>conflicts → one question"]
    plan["Plan + proof<br/>week grid · evidence drawer"]
    agent["Rebuild agent<br/>Muse Spark tool calling<br/>code checks every move"]
    cache[("Upstash<br/>encrypted 24h cache<br/>per-person limits")]
  end
  subgraph tmrw["Tomorrow (separate app)"]
    sched["Scheduler · SMS check-ins"]
  end
  up --> read --> check --> plan
  up --> sam --> check
  read -.- cache
  plan -- "Send: verified items only" --> sched
  sched -- "missed session + reply" --> agent
  agent -- "diff + one SMS" --> sched
  sched -- "texted photo" --> read
```

## Run it

Node 24 and pnpm 12.

```sh
pnpm install          # also enables the pre-commit hook (needs gitleaks: brew install gitleaks)
cp .env.example .env.local   # then set META_API_KEY
pnpm dev              # http://localhost:3000 (the sample week works without an API key)
pnpm test             # unit tests
pnpm test:visual      # every screen, light and dark, desktop and phone (after pnpm build; free)
pnpm smoke            # live calls to Meta Model API on synthetic fixtures (about 5 cents)
pnpm eval             # score the eval cases on recorded model readings (free, offline)
pnpm eval:live        # re-read fixtures whose recording is stale, then score (--force: all, about 22 cents)
pnpm eval:real        # the same on your own photos in local-inputs/ (git-ignored); prints numbers only
pnpm sample           # rebuild the app's sample week from the eval recordings (after eval:live)
pnpm eval:rebuild     # score the rebuild agent on recorded runs (free, offline)
pnpm eval:rebuild:live  # re-run stale rebuild cases, 3 runs each, with the judge (--force: all, about $2.30)
pnpm eval:extract     # score text-a-photo on recorded photo readings (free, offline)
pnpm eval:extract:live  # re-read photos whose recording is stale (about 5 cents)
```

How the app handles what people add: photos are shrunk and re-encoded in the browser (dropping EXIF, after reading the
capture time) and PDF pages are rendered there, so the server gets one small page per request and stores none of it.
Readings are cached for 24 hours by content hash, encrypted with a key derived from the image itself. Send relays
verified items to Tomorrow ([docs/IMPORT_CONTRACT.md](docs/IMPORT_CONTRACT.md)).

### Limits

Every model call is charged to someone, per UTC day. A call is one page or photo read, or one live rebuild; anything
answered from the cache is free and never counts.

| Who                                                                                    | Calls a day    | Dollars a day  |
| -------------------------------------------------------------------------------------- | -------------- | -------------- |
| A Tomorrow user (`user_ref` on `/api/rebuild` and `/api/extract`, hashed)              | 30             | $0.50          |
| Tomorrow requests without a `user_ref`, together (`tomorrow-unknown`)                  | only the brake | only the brake |
| A public visitor (a random id in a signed cookie, hashed)                              | 25             | $0.40          |
| One address, however many cookies it collects (hashed with the secret)                 | 75             | $1.50          |
| All public visitors together (`PUBLIC_DAILY_CAP_USD`)                                  |                | $5             |
| All Tomorrow users together (`TOMORROW_DAILY_CAP_USD`), separate from the public brake |                | $20            |

The owner skips the per-visitor and per-address rows: visiting `/owner?key=<OWNER_KEY>` once sets a signed,
httpOnly cookie; their calls still count toward the public brake and are logged as `owner`. Past a limit, a visitor sees "come back tomorrow" (the sample week and the recorded rebuilds are always free); Tomorrow
gets `code: "user_limit"` (429) or `"global_limit"` (503) and uses its own code-only rebuild. The counters live in
Upstash for two days and hold only hashed ids; the cookie (`lens_v`) is a random id with no other use.

### Environment

Names only; values go in `.env.local` locally and in Vercel's settings when deployed. [.env.example](.env.example)
lists every one, with its default.

| Name                                                 | What it's for                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `META_API_KEY`                                       | Meta Model API. Required for any model call                                                                               |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Limits, the reading cache, and review links. Required when deployed                                                       |
| `LENS_REBUILD_SECRET`                                | Shared with Tomorrow for `/api/rebuild` and `/api/extract`; signs review links and the cookie, keys the hashes            |
| `PUBLIC_DAILY_CAP_USD`                               | The public demo's brake (default: `DAILY_SPEND_CAP_USD` if set, else 5)                                                   |
| `TOMORROW_DAILY_CAP_USD`                             | Tomorrow's users' brake (default 20)                                                                                      |
| `DAILY_SPEND_CAP_USD`                                | Older name for `PUBLIC_DAILY_CAP_USD`, read only when that isn't set                                                      |
| `TOMORROW_IMPORT_URL`                                | Where Send delivers confirmed items (default `https://bettertmrw.app/api/lens/import`)                                    |
| `OWNER_KEY`                                          | Secret. `/owner?key=…` sets a signed cookie that skips the per-visitor and per-address limits (public brake still counts) |
| `LENS_PUBLIC_URL`                                    | Where review links point (default `https://tmrw-lens.vercel.app`)                                                         |
| `META_API_BASE_URL`, `MUSE_SPARK_MODEL`, `SAM_MODEL` | Optional overrides (Standard mode only)                                                                                   |

## Evals

Sixteen cases (`evals/cases/`) over the made-up fixtures in `fixtures/synthetic/`, two with deliberate conflicts
between sources. Each photo is read once, then second-read two ways: on SAM 3.1 object crops, and on plain box
crops, so the two columns differ only in SAM. Latest run, Muse Spark 1.3 and SAM 3.1 (`evals/results.json`):

|                                       | with SAM                                   | without SAM  |
| ------------------------------------- | ------------------------------------------ | ------------ |
| Invented dates                        | **0** of 210                               | **0** of 210 |
| Fully verified                        | **62%** (98 of 159)                        | **62%**      |
| Items found                           | 116 of 116                                 | 116 of 116   |
| Classes right                         | 43 of 43                                   | 43 of 43     |
| Dates right                           | 92 of 92, after answers 4 of 4             | same         |
| Conflicts caught                      | 4 of 4, pre-selected right 4 of 4, false 0 | same         |
| Photo quotes in an object (highlight) | 41 of 41                                   | none         |
| Model cost per photo                  | $0.0231                                    | $0.0173      |

"Fully verified" is lower than it was (71%) because the cases got harder on purpose: syllabi with "due next class",
ranges, "every Friday", dates written day first, and a page scanned sideways. Those are asked, never dated; a grid's
class days, which only the column says, are confirmed by the person.

### Speed

`pnpm bench` times a fixed set of synthetic files with live calls and no cache (p50 / p90, two runs each;
`evals/bench.json`). "First" is when the first page's items show; "full" is every page read and checked.

| Input                     | Before: first / full (p50)   | Now: first / full (p50) | Now, full p90 |
| ------------------------- | ---------------------------- | ----------------------- | ------------- |
| Text PDF (1-4 pages)      | 11.0 s / 12.5 s              | **6.7 s / 8.4 s**       | 10.7 s        |
| Photo (whiteboard, notes) | 20.3 s / 20.3 s              | 8.4 s* / **10.5 s**     | 11.6 s        |
| Testudo grid screenshot   | 64 s / 64 s                  | 18.7 s* / **21.3 s**    | 23.3 s        |
| Scanned PDF, 10 pages     | 10.9 s / 52 s                | **5.5 s / 26.5 s**      | 29.0 s        |
| Calendar file (.ics)      | not supported                | **instant** (no model)  |               |
| The same file again       | one cache round trip (< 1 s) | the same                |               |

\* when the page's own read is back; the page shows once its second read finishes (full). What made the difference:
pages with a text layer go as text (no vision); every page at once (eight in flight); the second-read batches in
parallel and smaller; a schedule-grid check that failed on every first try (forcing a full retry) fixed; minimal
reasoning for documents and schedules (photos stay at low, where minimal lost a line). Each call writes about 150
tokens a second, so a page's read takes a few seconds however it's sent.

### What it reads

PDF (text or scanned, up to 12 pages; password-protected ones get a plain message), Word (.docx), PowerPoint (.pptx),
Excel (.xlsx) and CSV, a saved course page (.html), pasted text, calendar exports (.ics, read in code with exact dates
and no model), and photos and screenshots (JPEG, PNG, WebP; HEIC where the browser can open it). Older Office formats
(.doc, .ppt, .xls) get a message to save as PDF or .docx.

Every date traces to a quote and a code computation, including dates relative to another item ("the day after Quiz
3" moves when the Quiz 3 conflict is answered), the end of every class recurrence, and every class meeting skipped for a
break. The rest of "fully verified" are real questions (conflicts, "in class" with no schedule, a course a note doesn't
name, class times worked out from where a block sits on a grid, which the person confirms in one question, a TBA
final, and a syllabus's quiz section and office hours, which are asked rather than guessed).

### Rebuild

When a planned session passes undone, Tomorrow calls `POST /api/rebuild`
([docs/REBUILD_CONTRACT.md](docs/REBUILD_CONTRACT.md)). Muse Spark, with five tools (`get_day`, `find_open_time`,
`move_item`, `drop_item`, `propose_diff`), decides what moves or drops and why; code computes the free time, refuses
any move that doesn't fit, and writes the one message from the reasons ("Moved Calc practice to 9pm today because it's
still free after practice and before the quiz tomorrow morning. Nothing else changed."). Try it on the homepage under
**Try a missed session**: eleven recorded cases replay for free, and "Rebuild it live" runs Muse Spark on your own
reply.

Rebuilds are held to a safety bar. **Hard rules, in code** ([src/lib/rebuild/rules.ts](src/lib/rebuild/rules.ts)): no
overlap with classes, sleep, quiet hours, or another item; after now and before the deadline; never within 90 minutes
of the miss unless it's due within a day; never within an hour of bedtime; the message's times exactly the moves'
(read back from its words); "Nothing else changed" true. The rebuild can't break them (code refuses the move), and the
finished rebuild is checked against them again. **Placement**, by an oracle in code
([src/lib/rebuild/rank.ts](src/lib/rebuild/rank.ts)): every slot is ranked by explicit weights (sooner, a lighter day,
urgency decides how much sooner matters: when the deadline is close, the soonest good time; when it isn't, quality (their
study time, a lighter day, a day's buffer, not right after the miss, never the morning of another quiz)); a run passes
only if its slot is in the top 3. **Reasons are code's words**: the agent picks one or two facts code checked true of the
time ("a lighter afternoon", "with a week to spare"), and anything about the reply comes from a structured note whose
exact words code finds in it ("so tonight can be off", "since you said only mornings work this week").

68 cases (`evals/rebuild/`), built the way Tomorrow builds a request: late-night skips, due in 4/6/12/24 hours, "too
tired", "busy until 9", sick, did half, no reply, a heavy day against a light one, weekends, both clock changes, a
session across midnight, two misses in a day, a deadline the professor moved, honest overload, morning and night
people, quiet hours, and replies that try to give orders. Live bug #1 (a 9:30pm miss moved to 10:30pm that night) is
case 1. Each case runs 3 times; a flaky case fails. The gates, all passing
([REVIEW.md](evals/rebuild/REVIEW.md) has every case):

|                                       | agent (reasoning effort low)   | code alone (fallback) |
| ------------------------------------- | ------------------------------ | --------------------- |
| Hard rules kept (gate: 100%)          | **100%** of 204 runs           | 100% of 68            |
| Placement top-1 / top-3 (gates 85/98) | **100% / 100%**                | –                     |
| Cases passed, all 3 runs              | **68 of 68**, 0 flaky          | 61 of 68              |
| Judge, tone and clarity (gate: 4.8)   | **4.95**                       |                       |
| Best time: would a friend pick it?    | **4.98** (gate: 4.8)           |                       |
| Every text one plain SMS              | yes, enforced by a test        | yes                   |
| Model cost per rebuild                | $0.0080 (3.7 turns, about 8 s) | free                  |
| Tokens per call, cache hit rate       | 3259 in, 243 out; 83% cached   |                       |

### Text a photo

Tomorrow sends Lens the photos someone texts (`POST /api/extract`, [docs/EXTRACT_CONTRACT.md](docs/EXTRACT_CONTRACT.md)),
with the items it already has. One cheap call says what each photo is and whether it can be read; then it's read and
verified like any upload. Lens returns the new items (only verified ones are auto-applicable), changes to existing items
with their evidence ("whiteboard says Quiz 3 → Mon Nov 2"), never applied until the person answers, one question per
ambiguity, and a signed review link that lasts 24 hours. Four synthetic cases (`evals/extract/cases.ts`): a whiteboard
moving a syllabus quiz, a course site's to-do list (alone, and against items already in Tomorrow), and a blurry photo:

|                                           | text-a-photo        |
| ----------------------------------------- | ------------------- |
| Auto-applied and right (precision)        | **9 of 9**          |
| Gold items auto-applied (recall)          | **100%**            |
| Invented dates                            | **0** of 13         |
| Changes caught (applied before an answer) | 2 of 2 (0)          |
| Duplicates recognized                     | 2 of 2              |
| Model cost per photo                      | $0.0127 (3.3 calls) |

## License

Apache-2.0
