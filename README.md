# tmrw-lens

Tomorrow Lens: photograph your week (schedules, syllabi, whiteboards) and get a verified, scheduled plan that rebuilds
when you miss something. Built on Meta's Muse Spark and SAM 3.1 for the Meta Global AI Developer Hackathon.

Built solo with AI coding assistance during the hackathon. See [HACKATHON.md](HACKATHON.md) for what was built when,
and [docs/PLAN.md](docs/PLAN.md) for the plan.

```mermaid
flowchart LR
  inputs["Testudo screenshot · syllabus PDF<br/>whiteboard photo · handwritten notes"] --> extract
  subgraph Lens
    extract["Extract<br/>Muse Spark"] --> verify["Verify<br/>quotes re-read · dates in code<br/>conflicts · merge"]
    verify --> card["Here's what I found<br/>evidence highlights"]
    rebuild["/api/rebuild agent<br/>Muse Spark tool calling"]
  end
  card -- "confirmed items" --> tomorrow["Tomorrow<br/>scheduler · reminders"]
  tomorrow -- "missed session" --> rebuild
  rebuild -- "diff + one message" --> tomorrow
```

## Run it

Node 24 and pnpm 12.

```sh
pnpm install          # also enables the pre-commit hook (needs gitleaks: brew install gitleaks)
cp .env.example .env.local   # then set META_API_KEY
pnpm dev              # http://localhost:3000
pnpm test             # unit tests
pnpm smoke            # live calls to Meta Model API on synthetic fixtures (about 5 cents)
```

## License

Apache-2.0
