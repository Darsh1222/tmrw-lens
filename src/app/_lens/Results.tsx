import Link from "next/link";
import { Reveal } from "./Reveal";
import extraction from "../../../evals/results.json";
import rebuild from "../../../evals/rebuild/results.json";

// IV · Results: the headline numbers, read from the same result files CI replays, so the page can't drift from them.

const r = rebuild.headline;
const invented = extraction.headline.with_sam.invented_dates; // "0 of 201"
const pct = (x: number) => `${Math.round(x * 100)}%`;

const STATS = [
  { value: pct(r.hard_rules), label: "Rebuild rules kept", note: `in ${r.cases * r.runs_per_case} runs: nothing in sleep, quiet hours, or past a deadline` }, // prettier-ignore
  { value: pct(r.top1), label: "Best-slot accuracy", note: `the time code's ranking picks, in ${r.cases} cases` },
  { value: invented.split(" ")[0], label: "Invented dates", note: `of ${invented.split(" of ")[1]}: every date traces to its words` }, // prettier-ignore
  { value: `$${r.cost_per_rebuild.toFixed(3)}`, label: "Per rebuild", note: `${r.turns_per_rebuild} model calls, about ${Math.round(r.latency_per_rebuild_s)} s` }, // prettier-ignore
];

export function Results() {
  return (
    <section id="results" aria-labelledby="results-heading" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="forum-caps">IV · Results</span>
        <Reveal id="results-heading" className="forum-display text-3xl sm:text-4xl" text="Measured, not promised." />
        <p className="max-w-2xl text-ink-2">
          Every number comes from made-up schedules and photos, replayed in CI on every change.
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => (
          <li key={s.label} className="grain paper-card flex flex-col gap-2 rounded-2xl border border-line bg-card p-6">
            <span className="forum-display text-5xl">{s.value}</span>
            <span className="font-medium">{s.label}</span>
            <span className="text-sm text-ink-2">{s.note}</span>
          </li>
        ))}
      </ul>
      <Link href="/evals" className="self-start text-ink underline decoration-crimson underline-offset-4 hover:decoration-2">
        See how each is measured
      </Link>
    </section>
  ); // prettier-ignore
}
