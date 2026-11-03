// The rebuild agent's merge gate. Every case (evals/rebuild/cases.ts) runs 3
// times; each run is checked by code three ways:
//   - the hard rules (src/lib/rebuild/rules.ts, plus the contract checks): must hold in every run of every case;
//   - what the case needs (move or drop, what the reply rules out, what must or mustn't change);
//   - placement: the oracle (src/lib/rebuild/rank.ts, with the case's reading of the reply) ranks every slot, and the
//     run's slot must be in its top 3; top-1 and top-3 rates are reported.
// A case passes when all 3 runs pass; runs that disagree make it flaky, which fails it. The judge (Muse Spark) scores
// tone and clarity. Gates: hard rules 100%, top-1 >= 85%, top-3 >= 98%, judge >= 4.8, every message one plain SMS,
// 0 regressions against the last results, 0 flaky cases. The exit code is 1 when a gate fails. The table of every
// case goes to evals/rebuild/REVIEW.md for review before merge.
//
//   pnpm eval:rebuild           replays recorded runs (free, offline, in CI)
//   pnpm eval:rebuild:live      runs cases whose recording is missing or stale; --force re-runs all
//   pnpm eval:rebuild -- --case live-1030pm-same-night --verbose
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DateTime } from "luxon";
import { readEnv } from "@/lib/env";
import type { CallResult, ReasoningEffort } from "@/lib/meta/client";
import { runTask } from "@/lib/meta/task";
import { brief, REBUILD_VERSION, rebuild, type Step } from "@/lib/rebuild/agent";
import { RebuildRequest, RebuildResponse } from "@/lib/rebuild/contract";
import { checkResponse, Draft, fallback, unkind } from "@/lib/rebuild/draft";
import { judgeTask, type Judgement } from "@/lib/rebuild/judge";
import { rankSlots, type Ranked } from "@/lib/rebuild/rank";
import { hardRuleViolations } from "@/lib/rebuild/rules";
import { REBUILD_CASES, type RebuildCase } from "../evals/rebuild/cases";

const ROOT = join(import.meta.dirname, "..");
const REC = join(ROOT, "evals", "rebuild", "recorded");
const RESULTS = join(ROOT, "evals", "rebuild", "results.json");
const REVIEW = join(ROOT, "evals", "rebuild", "REVIEW.md");
const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const live = args.includes("--live");
const force = args.includes("--force");
const verbose = args.includes("--verbose");
const only = flag("--case");
const effort = (flag("--effort") ?? "low") as ReasoningEffort;
const RUNS = Number(flag("--runs") ?? 3);
const CONCURRENCY = Number(flag("--concurrency") ?? 6);

export const GATES = { hardRules: 1, top1: 0.85, top3: 0.98, judge: 4.8 } as const;

type CallLine = Pick<CallResult, "usage" | "costUsd" | "latencyMs">;
type Run = {
  response: RebuildResponse;
  turns: number;
  refused: number;
  refusals: string[];
  steps: Step[];
  fell_back: string | null;
  calls: CallLine[];
  judge: Judgement | null;
  judge_calls: CallLine[];
};
/** The first run's fields stay at the top level (the demo panel and the SMS-length test read them). */
type Recording = Run & {
  agent_version: number;
  judge_version: number;
  request_sha: string;
  effort: ReasoningEffort;
  runs: Run[];
};

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const recPath = (c: RebuildCase) => join(REC, `${c.name}.json`);
const lines = (cs: CallResult[]): CallLine[] => cs.map(({ usage, costUsd, latencyMs }) => ({ usage, costUsd, latencyMs })); // prettier-ignore
const at = (req: RebuildRequest, s: string) => DateTime.fromFormat(s, "yyyy-MM-dd HH:mm", { zone: req.zone }).toMillis(); // prettier-ignore

function changesText(req: RebuildRequest, res: RebuildResponse): string {
  const d = new Draft(req);
  return res.diff
    .filter((x) => x.action !== "keep")
    .map((x) => {
      const t = d.item(x.item_id)!.title;
      return x.action === "drop" ? `- dropped "${t}"` : `- moved "${t}" to ${d.at({ s: Date.parse(x.start!), e: Date.parse(x.end!) })}`; // prettier-ignore
    })
    .join("\n");
}

async function judge(req: RebuildRequest, res: RebuildResponse) {
  const d = new Draft(req);
  const free = d.free().map((x) => d.at(x));
  const text = `Facts:\n${brief(d)}\nAll free time from now on, before any change: ${free.join(", ") || "none"}.\n\nChanges:\n${changesText(req, res)}\n\nMessage:\n${res.message}`;
  return runTask(judgeTask, [{ type: "input_text", text }], { env: readEnv(), log: () => {} });
}

/** The oracle: every slot for the missed item that the case's reading of the reply allows, best first. */
export function oracle(c: RebuildCase): Ranked[] {
  const req = RebuildRequest.parse(c.request);
  const d = new Draft(req);
  // Items the case lets move make their time available, as moving them would.
  for (const id of c.expect.changed ?? []) d.changes.set(id, { action: "drop", reason: "oracle" });
  return rankSlots(d, req.missed.item_id, {
    minutes: c.expect.minutes,
    after: c.expect.not_before ? at(req, c.expect.not_before) : undefined,
    exclude: (c.expect.rule_out ?? []).map(([a, b]) => ({ s: at(req, a), e: at(req, b) })),
    free: d.free(req.missed.item_id),
  });
}

/** What the case needs that this rebuild didn't do. */
function misses(c: RebuildCase, res: RebuildResponse): string[] {
  const e = c.expect;
  const req = c.request;
  const out: string[] = [];
  const by = new Map(res.diff.map((x) => [x.item_id, x]));
  const m = by.get(req.missed.item_id)!;
  if (m.action !== e.missed) out.push(`missed item: ${m.action}, expected ${e.missed}`);
  if (m.action === "move" && e.ends_by && Date.parse(m.end!) > at(req, e.ends_by)) out.push(`ends after ${e.ends_by}`);
  if (m.action === "move" && e.max_minutes && (Date.parse(m.end!) - Date.parse(m.start!)) / 60_000 > e.max_minutes)
    out.push(`longer than ${e.max_minutes} min`);
  for (const x of res.diff) {
    if (x.action !== "move") continue;
    const [s, en] = [Date.parse(x.start!), Date.parse(x.end!)];
    if (e.not_before && s < at(req, e.not_before)) out.push(`${x.item_id} before ${e.not_before}`);
    for (const [a, b] of e.rule_out ?? []) if (s < at(req, b) && at(req, a) < en) out.push(`${x.item_id} in time the reply ruled out`); // prettier-ignore
  }
  const changed = res.diff.filter((x) => x.action !== "keep").length;
  if (changed > e.max_changes) out.push(`${changed} changes, at most ${e.max_changes}`);
  for (const id of e.keep ?? []) if (by.get(id)?.action !== "keep") out.push(`${id} should stay`);
  for (const id of e.changed ?? []) if (by.get(id)?.action === "keep") out.push(`${id} should move or drop`);
  return out;
}

type Score = { hard: string[]; misses: string[]; rank: number | null; top1: boolean; top3: boolean; pass: boolean };

function scoreRun(c: RebuildCase, ranked: Ranked[], res: RebuildResponse): Score {
  const req = RebuildRequest.parse(c.request);
  const hard = [...new Set([...checkResponse(req, res), ...hardRuleViolations(req, res)])];
  const miss = misses(c, res);
  const m = res.diff.find((x) => x.item_id === req.missed.item_id)!;
  let rank: number | null = null;
  if (m.action === "move") {
    const [s, e] = [Date.parse(m.start!), Date.parse(m.end!)];
    // In the stretch, and as long as the oracle's session there: a shortened session doesn't match a full one.
    const i = ranked.findIndex((x) => s >= x.s && e <= x.e && (e - s) / 60_000 >= x.minutes);
    rank = i < 0 ? null : i + 1;
  }
  // A drop is right exactly when the case expects one; a move is right when it's in the oracle's top 3.
  const placed = c.expect.missed === "drop" ? m.action === "drop" : rank !== null && rank <= 3;
  const top1 = c.expect.missed === "drop" ? m.action === "drop" : rank === 1;
  return { hard, misses: miss, rank, top1, top3: placed, pass: !hard.length && !miss.length && placed };
}

async function pool<T>(xs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (next < xs.length) {
      const k = next++;
      out[k] = await xs[k]();
    }
  })); // prettier-ignore
  return out;
}

mkdirSync(REC, { recursive: true });
const cases = REBUILD_CASES.filter((c) => !only || c.name === only);
let spent = 0;

// Live: run what's missing or stale, several cases at once.
const load = (c: RebuildCase): Recording | null => (existsSync(recPath(c)) ? JSON.parse(readFileSync(recPath(c), "utf8")) : null); // prettier-ignore
const stale = (c: RebuildCase, rec: Recording | null) =>
  !rec || !rec.runs || rec.runs.length < RUNS || rec.agent_version !== REBUILD_VERSION || rec.request_sha !== sha(RebuildRequest.parse(c.request)) || (!!flag("--effort") && rec.effort !== effort); // prettier-ignore
if (live) {
  const todo = cases.filter((c) => force || stale(c, load(c)));
  if (todo.length) console.log(`Running ${todo.length} case(s) x ${RUNS} with ${readEnv().MUSE_SPARK_MODEL}, effort ${effort}...`); // prettier-ignore
  const jobs = todo.flatMap((c) =>
    Array.from({ length: RUNS }, (_, k) => async (): Promise<[string, number, Run]> => {
      const req = RebuildRequest.parse(c.request);
      const run = await rebuild(req, { effort, log: () => {} });
      const response = RebuildResponse.parse(run.response);
      const j = await judge(req, response).catch(() => null);
      spent += run.calls.reduce((a, x) => a + x.costUsd, 0) + (j ? j.calls.reduce((a, x) => a + x.costUsd, 0) : 0);
      return [c.name, k, { response, turns: run.turns, refused: run.refused, refusals: run.refusals, steps: run.steps, fell_back: run.fellBack, calls: lines(run.calls), judge: j?.data ?? null, judge_calls: j ? lines(j.calls) : [] }]; // prettier-ignore
    }),
  );
  const done = await pool(jobs, CONCURRENCY);
  for (const c of todo) {
    const runs = done
      .filter(([n]) => n === c.name)
      .sort((a, b) => a[1] - b[1])
      .map(([, , r]) => r);
    const rec: Recording = { agent_version: REBUILD_VERSION, judge_version: judgeTask.version, request_sha: sha(RebuildRequest.parse(c.request)), effort, ...runs[0], runs }; // prettier-ignore
    writeFileSync(recPath(c), JSON.stringify(rec, null, 2) + "\n");
  }
}

type Row = {
  c: RebuildCase;
  ranked: Ranked[];
  runs: { run: Run; score: Score }[];
  pass: boolean;
  flaky: boolean;
  fallback: Score;
  recorded: boolean;
};
const rows: Row[] = cases.map((c) => {
  const ranked = oracle(c);
  const rec = load(c);
  const usable = rec && !stale(c, rec) ? rec.runs : [];
  const runs = usable.map((run) => ({ run, score: scoreRun(c, ranked, run.response) }));
  const passes = runs.map((r) => r.score.pass);
  const fb = scoreRun(c, ranked, fallback(RebuildRequest.parse(c.request)).response("fallback"));
  return {
    c,
    ranked,
    runs,
    pass: runs.length >= RUNS && passes.every(Boolean),
    flaky: new Set(passes).size > 1,
    fallback: fb,
    recorded: runs.length >= RUNS,
  };
});

const all = rows.flatMap((r) => r.runs);
const pct = (k: number, n: number) => (n ? k / n : 0);
const moveRuns = rows.filter((r) => r.c.expect.missed === "move").flatMap((r) => r.runs);
const judged = all.flatMap((r) => (r.run.judge ? [r.run.judge.score] : []));
const calls = all.flatMap((r) => r.run.calls);
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const tokensIn = sum(calls.map((x) => x.usage.input_tokens));
const baseline: { cases?: { name: string; pass?: boolean; right?: boolean }[] } = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")) : {}; // prettier-ignore
const before = new Map((baseline.cases ?? []).map((x) => [x.name, x.pass ?? x.right ?? false]));
const regressions = rows.filter((r) => before.get(r.c.name) === true && !r.pass).map((r) => r.c.name);
const headline = {
  cases: rows.length,
  runs_per_case: RUNS,
  effort,
  cases_passed: `${rows.filter((r) => r.pass).length}/${rows.length}`,
  hard_rules: pct(all.filter((r) => !r.score.hard.length).length, all.length),
  top1: pct(moveRuns.filter((r) => r.score.top1).length, moveRuns.length),
  top3: pct(moveRuns.filter((r) => r.score.top3).length, moveRuns.length),
  judge_score: judged.length ? Number((sum(judged) / judged.length).toFixed(2)) : null,
  judge_min: judged.length ? Math.min(...judged) : null,
  unkind_messages: all.filter((r) => unkind(r.run.response.message)).length,
  flaky: rows.filter((r) => r.flaky).map((r) => r.c.name),
  regressions,
  unrecorded: rows.filter((r) => !r.recorded).map((r) => r.c.name),
  fell_back: `${all.filter((r) => r.run.fell_back).length}/${all.length}`,
  cost_per_rebuild: all.length ? Number((sum(calls.map((x) => x.costUsd)) / all.length).toFixed(5)) : 0,
  turns_per_rebuild: all.length ? Number((sum(all.map((r) => r.run.turns)) / all.length).toFixed(1)) : 0,
  latency_per_rebuild_s: all.length ? Number((sum(calls.map((x) => x.latencyMs)) / all.length / 1000).toFixed(1)) : 0,
  tokens_per_call: calls.length ? `${Math.round(tokensIn / calls.length)} in, ${Math.round(sum(calls.map((x) => x.usage.output_tokens)) / calls.length)} out` : "-", // prettier-ignore
  cache_hit_rate: tokensIn ? `${Math.round((100 * sum(calls.map((x) => x.usage.cached_tokens))) / tokensIn)}%` : "-",
  fallback_hard_rules: pct(rows.filter((r) => !r.fallback.hard.length).length, rows.length),
  fallback_cases_passed: `${rows.filter((r) => r.fallback.pass).length}/${rows.length}`,
};
const gates = {
  "hard rules 100%": headline.hard_rules >= GATES.hardRules && headline.fallback_hard_rules >= GATES.hardRules,
  "top-1 >= 85%": headline.top1 >= GATES.top1,
  "top-3 >= 98%": headline.top3 >= GATES.top3,
  "judge >= 4.8": (headline.judge_score ?? 0) >= GATES.judge,
  "0 regressions": !regressions.length,
  "0 flaky": !headline.flaky.length,
  "every case recorded": !headline.unrecorded.length,
  "0 unkind messages": !headline.unkind_messages,
};

// The review table.
const fmt = (req: RebuildRequest, ms: number) => DateTime.fromMillis(ms, { zone: req.zone }).toFormat("ccc d h:mma").replace(":00", ""); // prettier-ignore
const slot = (req: RebuildRequest, x: Ranked) => `${fmt(req, x.start)} (${x.minutes}m)`;
const chosen = (req: RebuildRequest, res: RebuildResponse) => {
  const m = res.diff.find((x) => x.item_id === req.missed.item_id)!;
  return m.action === "drop" ? (res.offer ? "drop + offer" : "drop") : `${fmt(req, Date.parse(m.start!))} (${Math.round((Date.parse(m.end!) - Date.parse(m.start!)) / 60_000)}m)`; // prettier-ignore
};
const esc = (s: string) => s.replace(/\|/g, "\\|");
const table = [
  "| # | Case | Group | Expected best (oracle #1) | Oracle #2, #3 | Chosen (run 1 / 2 / 3) | Rank | Pass | Message (run 1) | Problems |",
  "| - | ---- | ----- | ------------------------- | ------------- | ---------------------- | ---- | ---- | --------------- | -------- |",
  ...rows.map((r, n) => {
    const req = RebuildRequest.parse(r.c.request);
    const best = r.c.expect.missed === "drop" ? (r.ranked.length ? `drop (but oracle has ${slot(req, r.ranked[0])})` : "drop") : r.ranked[0] ? slot(req, r.ranked[0]) : "nothing (case error)"; // prettier-ignore
    const next =
      r.c.expect.missed === "drop"
        ? ""
        : r.ranked
            .slice(1, 3)
            .map((x) => slot(req, x))
            .join(", ");
    const picks = r.runs.map((x) => chosen(req, x.run.response)).join(" / ") || "not recorded";
    const ranks = r.runs.map((x) => (r.c.expect.missed === "drop" ? (x.score.top1 ? "ok" : "x") : (x.score.rank ?? "-"))).join("/"); // prettier-ignore
    const problems = [...new Set(r.runs.flatMap((x) => [...x.score.hard, ...x.score.misses]))].join("; ");
    return `| ${n + 1} | ${r.c.name} | ${r.c.group ?? ""} | ${best} | ${next} | ${picks} | ${ranks} | ${r.pass ? "pass" : r.flaky ? "FLAKY" : "FAIL"} | ${esc(r.runs[0]?.run.response.message ?? "")} | ${esc(problems)} |`; // prettier-ignore
  }),
].join("\n");
writeFileSync(
  REVIEW,
  `# Rebuild review\n\nGenerated by \`pnpm eval:rebuild\` (agent v${REBUILD_VERSION}, effort ${effort}, ${RUNS} runs per case). The oracle ranks every slot the hard rules and the case's reading of the reply allow (src/lib/rebuild/rank.ts); Rank is where each run's slot falls in it. A case passes when all ${RUNS} runs keep every hard rule, do what the case needs, and land in the top 3.\n\n| Gate | Result |\n| ---- | ------ |\n${Object.entries(gates).map(([k, v]) => `| ${k} | ${v ? "pass" : "FAIL"} |`).join("\n")}\n\nHard rules ${(headline.hard_rules * 100).toFixed(1)}% of runs (code's fallback ${(headline.fallback_hard_rules * 100).toFixed(0)}% of cases) · top-1 ${(headline.top1 * 100).toFixed(1)}% · top-3 ${(headline.top3 * 100).toFixed(1)}% · judge ${headline.judge_score} (lowest ${headline.judge_min}) · ${headline.cases_passed} cases pass · $${headline.cost_per_rebuild.toFixed(4)} per rebuild.\n\n${table}\n`, // prettier-ignore
);

console.log(`\nRebuild evals: ${rows.length} cases x ${RUNS} runs, effort ${effort}`);
console.log(`Cases passed            ${headline.cases_passed}`);
console.log(`Hard rules              ${(headline.hard_rules * 100).toFixed(1)}% of runs   (code's fallback: ${(headline.fallback_hard_rules * 100).toFixed(0)}% of cases, ${headline.fallback_cases_passed} pass)`); // prettier-ignore
console.log(`Placement top-1 / top-3 ${(headline.top1 * 100).toFixed(1)}% / ${(headline.top3 * 100).toFixed(1)}%`);
console.log(`Judge (1-5)             ${headline.judge_score ?? "-"}   (lowest ${headline.judge_min ?? "-"}, ${judged.length} judged)`); // prettier-ignore
console.log(`Flaky cases             ${headline.flaky.length ? headline.flaky.join(", ") : "none"}`);
console.log(`Regressions             ${regressions.length ? regressions.join(", ") : "none"}`);
console.log(`Cost per rebuild        $${headline.cost_per_rebuild.toFixed(4)}   (${headline.turns_per_rebuild} turns, ${headline.latency_per_rebuild_s}s); tokens per call ${headline.tokens_per_call}; cache ${headline.cache_hit_rate}`); // prettier-ignore
for (const [k, v] of Object.entries(gates)) console.log(`  ${v ? "pass" : "FAIL"}  ${k}`);
for (const r of rows.filter((x) => !x.pass)) {
  const why = [...new Set(r.runs.flatMap((x) => [...x.score.hard, ...x.score.misses, ...(x.score.top3 ? [] : [`rank ${x.score.rank ?? "none"}`])]))]; // prettier-ignore
  console.log(`  ${r.flaky ? "flaky" : "fail "} ${r.c.name}: ${why.join("; ") || (r.recorded ? "" : "not recorded")}`);
}
if (verbose)
  for (const r of rows) {
    const req = RebuildRequest.parse(r.c.request);
    console.log(`\n${r.c.name}: ${r.c.about}`);
    console.log(`  oracle: ${r.ranked.slice(0, 3).map((x) => `${slot(req, x)} [${x.score}: ${x.why.join(", ")}]`).join(" | ") || "nothing"}`); // prettier-ignore
    for (const x of r.runs) console.log(`  run: ${chosen(req, x.run.response)} rank ${x.score.rank ?? "-"} judge ${x.run.judge?.score ?? "-"}: ${x.run.response.message}`); // prettier-ignore
  }
if (spent) console.log(`Model spend this run: $${spent.toFixed(4)}`);

if (!only)
  writeFileSync(
    RESULTS,
    JSON.stringify(
      {
        headline,
        gates,
        cases: rows.map((r) => ({
          name: r.c.name,
          group: r.c.group ?? null,
          pass: r.pass,
          flaky: r.flaky,
          expected_best: r.ranked[0]
            ? DateTime.fromMillis(r.ranked[0].start, { zone: r.c.request.zone }).toISO()
            : null,
          ranks: r.runs.map((x) => x.score.rank),
          judge: r.runs.map((x) => x.run.judge?.score ?? null),
          problems: [...new Set(r.runs.flatMap((x) => [...x.score.hard, ...x.score.misses]))],
        })),
      },
      null,
      2,
    ) + "\n",
  );

if (Object.values(gates).some((v) => !v)) process.exitCode = 1;
