# Product direction — November 16, 2026

Decision: ship **one next step, with its source and honest remaining work**. A returning task card connects the existing reader's evidence, the person's explicit progress, and a checked plan for only unfinished work. “First in Lens” means newly implemented in this repository. We have not established a world first, a patentable invention, market exclusivity, product-market fit, or a likelihood of winning.

## What the market already covers

| Product                                                                                                | Relevant documented capability                                                       | Consequence for Lens                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Motion](https://www.usemotion.com/help/time-management/auto-scheduling)                               | Scheduling by duration, availability, deadlines and priorities; dynamic rescheduling | Automatic scheduling alone is not differentiation.                                                                                                            |
| [Shovel](https://shovelapp.io/)                                                                        | Syllabus/LMS intake, study auto-planning, replanning and spare-time Cushion          | Syllabus-to-calendar, missed-session recovery and spare-time estimates are already combined.                                                                  |
| [Reclaim 2.0](https://help.reclaim.ai/en/articles/16558552-tasks-overview-decide-what-to-work-on-when) | Integrated tasks, relevant-now/at-risk recommendations, calendar context and memory  | A generic “what next?” or memory feature is not new by itself. Its current task workflow differs from legacy 1.0; do not cite old scheduling docs as current. |
| [Sunsama](https://help.sunsama.com/docs/getting-started/basics/daily-planning-the-basics/)             | Guided daily planning, duration estimates, workload review and deferral              | Calm guided planning already exists.                                                                                                                          |
| [Goblin Tools](https://goblin.tools/About)                                                             | Small AI-powered tools for difficult everyday tasks                                  | Simplicity and small task tools already have established examples.                                                                                            |

This is a focused review of public official pages, not an exhaustive hands-on competitive audit. An undocumented feature may exist. The differentiation hypothesis is the particular student workflow: exact deadline evidence remains visible beside a minimal next action; completed steps are explicit; a disruption changes only reported remaining work under unchanged hard constraints. Real student usefulness is not established by this desk research.

## Reproducible selection

Run `node scripts/rank-product-ideas.ts`. Inputs and rationales are in `product-ideas.json`; generated results are in `product-ranking.json`.

Weighted score = 0.30 usefulness + 0.20 differentiation + 0.25 simplicity + 0.15 feasibility + 0.10 measurability, each rating 0–5. These are disclosed editorial judgments, not trained estimates. Simplicity receives substantial weight because the owner explicitly requested it. Usefulness and feasibility consider the existing implementation and time before the hackathon.

| Candidate                                             | Decision score / 5 |
| ----------------------------------------------------- | -----------------: |
| Evidence-linked next step and remaining-work recovery |              4.525 |
| Review the deadline ambiguity that blocks action      |              4.130 |
| Stress-test underestimated effort                     |              3.740 |
| Generate a smaller first action                       |              3.620 |
| Coordinate study recovery with a peer                 |              3.235 |
| Broad conversational productivity assistant           |              2.895 |

Sensitivity: 5,000 seeded scenarios vary weights ±30%, normalize them, and vary each subjective rating ±0.6 (bounded 0–5). The selected idea leads in 4,708 scenarios, the uncertainty-review idea in 291, and the robustness idea in 1. This is model stability under chosen assumptions, **not a 94.16% chance of success**. Different evidence or judgments can change the result. Run the script again after user testing; do not tune ratings to preserve this choice.

## Shipped scope

One next-step card after approving a plan. Two immediate actions: **Finished this step** and **Plans changed**. Deadline source, complete remaining sessions, undo, calendar export, and saving controls stay in disclosures. No streaks, global productivity score, inferred mood, or auto-completion from a clock.

Finishing a step credits that step's planned minutes only from the person's report; actual elapsed effort is recorded separately and optionally after the whole task. Replanning freezes the remaining-work estimate, preserves the source/deadline and fixed constraints, retains previously approved other-task moves, and previews before applying. A final independent check uses the action-time clock. No complete result means no silent dropping or sleep borrowing. Search remains bounded as documented in RECOVERY_WORKSPACE.md.

The card survives refresh within the tab. Remembering after closing the tab is opt-in browser-local storage. Saved tasks contain neither model credentials nor the person's learning-history records. Examples cannot replace personal saved tasks or train effort history. A manually entered or edited deadline is not presented as verified source evidence.

## Test the impact hypothesis next

With consent, ask five students to form a correct plan and recover an interrupted task. Compare to their usual method, vary which method they try first, and record time, deadline errors, help required, and whether the remaining work is understood. Keep individual paired observations; a small convenience sample cannot establish broad effects on grades or wellbeing. No participant results have been collected. Predetermined pilot target: at least four of five complete both flows without guidance and no unresolved deadline error; target is not a reported result. Findings should change the product and the decision ratings.
