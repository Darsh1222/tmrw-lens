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
