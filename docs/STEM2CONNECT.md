# STEM2Connect submission preparation — November 16, 2026

Primary track: Education. Lens originally built October 28–November 4 and previously entered in a competition. Original release remains v1.0-hackathon. The separate Tomorrow assistant existed earlier. Do not imply this preparation changes that history. Prior-entry eligibility is not explicitly answered by the rules and needs organizer clarification.

This branch adds /demo, links from the homepage and footer, derives hero counts from evaluation results, qualifies synthetic results and internal ranking agreement, corrects the 19-case extraction count, and credits Codex assistance. It does not claim to have collected student results.

Reviewer path: /demo → recorded recovery → /#sample-week → inspect a date → answer the quiz conflict → Undo last answer → Add to calendar. No account or AI key is needed for these recorded examples. Live uploads and custom replies need configured Meta access and production limits. SMS requires access to Tomorrow; it is not necessary to demonstrate Lens's standalone calendar output.

Evidence: evals/results.json, evals/rebuild/results.json, evals/extract/results.json. Recorded replay is a code regression check, not a fresh model benchmark. Best-slot agreement is internal. SAM adds evidence localization in this set, not an extraction-score improvement. Average recorded rebuild cost $0.008 = 0.8 cents.

Known pending items: final ≤6-minute public/unlisted demo URL, organizer clarification, builder review of personal learning narrative, Devpost entry and team roster, November 24 Demo Day arrangements. Student testing is planned, not complete.

## Expanded recovery implementation

The branch now also contains the working /recover flow described in [RECOVERY_WORKSPACE.md](RECOVERY_WORKSPACE.md): obstacle-aware comparisons, small-step recovery, effort calibration, feedback controls, verified-source handoff, and explicit capacity limits. This is additional November 16 work. The older 3:09 review video does not show these new features; record an updated demo before representing them in the video. Existing recorded-agent metrics apply to the older agent, not this new planner.
