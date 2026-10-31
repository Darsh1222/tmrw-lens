# Tomorrow Lens

Photograph your week (Testudo schedule, syllabus PDF, whiteboard, handwritten notes) and get a verified plan that
rebuilds when you miss something. Built on Meta's Muse Spark and SAM 3.1 for the Meta Global AI Developer Hackathon
(build Oct 27 to Nov 4, 2026; submit Nov 4 about 2 PM ET). Public repo, Apache-2.0.

## Source of truth

- `docs/PLAN.md`: scope, MVP, cut order, schedule. If code and PLAN disagree, PLAN wins.
- `docs/DECISIONS.md`: append a dated line for every judgment call PLAN doesn't cover.
- `HACKATHON.md`: dated "what's new" log. Add an entry with every meaningful change, the same day.

## Stack

Next.js 16 (App Router) + TypeScript (strict) + Tailwind v4 (tokens in `src/app/globals.css`) · zod 4 · Luxon ·
Vitest · pnpm 12, Node 24. Meta Model API over plain `fetch` (no SDK). Vercel hosting, Vercel Blob for uploads (24h),
Upstash Redis (REST) for the spend cap and rate limits. No database: Tomorrow owns the plan.

## Commands

- `pnpm dev` / `pnpm build` / `pnpm start`
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (`pnpm format` to fix), `pnpm test` (unit, `tests/unit/`)
- `pnpm smoke`: live calls to Meta Model API on the synthetic fixtures (text, image, PDF page rendered and native,
  SAM). Reads `.env.local`. About 5 cents.
- `pnpm fixtures`: regenerate `fixtures/synthetic/` (all made up; byte-identical across runs) and its `manifest.json`.
- `pnpm eval`: score `evals/cases/` against recorded model readings (offline, free, in CI). Headline numbers: "% fully
  verified" and "invented dates", each with and without SAM, plus model cost per photo, tokens per call, and cache
  hit rate. `pnpm eval:live` re-reads only fixtures whose recording is stale and re-records (`--force` for all, about
  22 cents); run it after changing a task's instructions or schema (and bump its `version`), how photos are cropped
  (bump `CROP_VERSION` in `src/lib/extract/read.ts`), or a fixture.
- `pnpm eval:real`: the same on your own photos in `local-inputs/` (git-ignored, recordings too). Prints numbers only.
- `pnpm check:env`: fails if any `.env*` file other than `.env.example` is tracked. Runs in the pre-commit hook and CI.
- `pnpm check:secrets`: gitleaks over the full git history.
- The pre-commit hook (`.githooks/pre-commit`, enabled by `pnpm install`) runs `check:env` and gitleaks on staged
  changes, and refuses to commit if gitleaks isn't installed (`brew install gitleaks`).

## Conventions

- Validate every external boundary with zod: API routes, model output, the Tomorrow contracts, file parsing.
- All model calls go through `createResponse()` in `src/lib/meta/client.ts` (retries, timeouts, cost log, daily
  spend cap). Structured calls are tasks run with `runTask()` (`src/lib/meta/task.ts`): a zod schema, a `check` for
  what a schema can't say, one retry with the problem. Model IDs come from env (defaults in `src/lib/env.ts`).
- Standard mode only, never `-contributor` models: those let Meta train on what we send, and visitors send their own
  schedules.
- The model reads; code computes. Extraction returns dates, days, and times as written ("Week 7 Thu", "TuTh") plus an
  exact quote and a 0-1000 box. Code resolves dates (Luxon, with the term start), converts boxes to 0-1, checks every
  field appears in its quote, and flags conflicts with class blocks.
- Every extracted field has a status: verified, needs_question, unverified, or conflict. Unverified fields are amber
  and never sent to Tomorrow until the person edits or confirms them. Conflicting sources are never merged silently:
  one question, likely answer pre-selected with its reason, applied only when the person answers. One question per
  ambiguity. Every date traces to a quote plus a code computation (`src/lib/plan/audit.ts`).
- Store times in UTC with an IANA zone; render in the person's zone. Test DST.
- Never log content: no file bytes, quotes, prompts, or replies. The cost log records task, model, tokens, cost, and
  latency only.
- Copy is plain, calm, and specific. No guilt, streaks, cheerleading, or fake urgency, least of all in rebuild
  messages ("Moved X to Thu 4pm because... Nothing else changed.").

## Cost–quality policy

Every feature, and every prompt or model change, follows this. (Written for Lens and Tomorrow alike; where Lens has
no such thing yet, the Lens note says so.)

1. Quality floor first. Eval targets (judge score, verification %, 0 invented dates, correction rate) never go down
   to save money. Cost cuts ship only if evals show equal or better quality.
2. Code before models. Dates, times, availability, conflicts, math, totals, and formatting are computed in code
   (free, exact). Models only read, decide, and write.
3. Route by difficulty. The cheapest model that passes evals for each task: MODEL_FAST for classification, safety,
   simple replies and single adds; MODEL_SMART for multi-item dumps, conflicts, planning trade-offs, rebuilds.
   Escalate to the bigger model automatically when confidence is low or a check fails, never the other way around.
   Lens has one text model (Muse Spark), so it routes by reasoning effort: `minimal` for re-reads, `low` for
   extraction; `runTask` retries a failed check one effort step up.
4. Prompt caching on every stable prefix (system prompt, tool definitions, static rules). Report cache hit rate.
   Meta Model API caches prefixes automatically; task instructions go first and `prompt_cache_key` is the task name.
5. Small context. Send only what the turn needs (recent messages, today/tomorrow, relevant items), not the whole
   history. Measure tokens per turn. (Lens sends one page or photo per call; `pnpm eval` reports tokens per call.)
6. Cap output length per task (`maxOutputTokens` on every task); SMS replies stay short by design.
7. Never pay twice. Cache file and image extraction by content hash; don't re-run a model on unchanged input.
8. Batch what can wait (weekly recaps, pattern detection, eval runs) via the Batch API. (Meta Model API documents no
   Batch API yet; use it when it exists.)
9. Checks over bigger models. Prefer a cheap verification step (schema + code checks + one targeted re-read) to
   upgrading the whole task to a larger model.
10. Measure. Admin shows cost per turn, cost per active user per week, tokens per turn, cache hit rate,
    fallback/escalation rate, alongside judge score and correction rate. Every PR that touches prompts or models
    reports before/after on both quality and cost. (Lens: `pnpm eval` before and after, from `evals/results.json`.)

## Public repo rules

- Never commit secrets. `META_API_KEY` and everything else live in `.env.local` (git-ignored). Keep `.env.example`
  current; `tests/unit/env.test.ts` fails if it drifts from `src/lib/env.ts`.
- Fixtures are synthetic only. Real inputs go in `local-inputs/` (git-ignored).
- Only hackathon-built work lives here. `~/Developer/Tomorrow` is a separate private app: read its docs for
  conventions if useful, but never copy its code, data, secrets, or config into this repo. Lens talks to it only
  through the HTTP contracts in PLAN (`POST /api/lens/import` on Tomorrow, `POST /api/rebuild` on Lens).

## Definition of done

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm check:env`, and `pnpm build` pass; HACKATHON.md
and DECISIONS.md updated; report what changed, how to try it, and what's left or risky.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read
the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->
