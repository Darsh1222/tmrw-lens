// Scores the rebuild agent on evals/rebuild/cases.ts: is every move valid (CI
// fails otherwise), are the messages free of unkind words (CI fails otherwise),
// does each rebuild do what the case needs, and the judge's score of each
// message. Code's fallback is scored on the same cases, as the bar the agent
// has to clear. Also: turns, model cost per rebuild, tokens per call, and the
// prompt cache hit rate.
//
//   pnpm eval:rebuild          replays recorded rebuilds (free, offline, runs in CI)
//   pnpm eval:rebuild:live     re-runs cases whose recording is missing or stale (case, agent, or judge changed)
//                              and records them; --force re-runs all (about 5 cents); --effort medium to compare
//   pnpm eval:rebuild -- --case make-room --verbose
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DateTime } from "luxon";
import { readEnv } from "@/lib/env";
import type { CallResult, ReasoningEffort } from "@/lib/meta/client";
import { runTask } from "@/lib/meta/task";
import { brief, REBUILD_VERSION, rebuild } from "@/lib/rebuild/agent";
import { RebuildRequest, RebuildResponse } from "@/lib/rebuild/contract";
import { checkResponse, Draft, fallback, unkind } from "@/lib/rebuild/draft";
import { judgeTask, type Judgement } from "@/lib/rebuild/judge";
import { REBUILD_CASES, type RebuildCase } from "../evals/rebuild/cases";

const ROOT = join(import.meta.dirname, "..");
const REC = join(ROOT, "evals", "rebuild", "recorded");
const RESULTS = join(ROOT, "evals", "rebuild", "results.json");
const args = process.argv.slice(2);
const live = args.includes("--live");
const force = args.includes("--force");
const verbose = args.includes("--verbose");
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const effort = (args.includes("--effort") ? args[args.indexOf("--effort") + 1] : "low") as ReasoningEffort;

type CallLine = Pick<CallResult, "usage" | "costUsd" | "latencyMs">;
type Recording = {
  agent_version: number;
  judge_version: number;
  request_sha: string;
  effort: ReasoningEffort;
  response: RebuildResponse;
  turns: number;
  refused: number;
  refusals: string[];
  fell_back: string | null;
  calls: CallLine[];
  judge: Judgement | null;
  judge_calls: CallLine[];
};

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const recPath = (c: RebuildCase) => join(REC, `${c.name}.json`);
const lines = (cs: CallResult[]): CallLine[] =>
  cs.map(({ usage, costUsd, latencyMs }) => ({ usage, costUsd, latencyMs }));
const at = (req: RebuildRequest, s: string) =>
  DateTime.fromFormat(s, "yyyy-MM-dd HH:mm", { zone: req.zone }).toMillis();

function changesText(req: RebuildRequest, res: RebuildResponse): string {
  const d = new Draft(req);
  return res.diff
    .filter((x) => x.action !== "keep")
    .map((x) => {
      const t = d.item(x.item_id)!.title;
      return x.action === "drop"
        ? `- dropped "${t}"`
        : `- moved "${t}" to ${d.at({ s: Date.parse(x.start!), e: Date.parse(x.end!) })}`;
    })
    .join("\n");
}

async function judge(req: RebuildRequest, res: RebuildResponse) {
  // The judge sees all the free time, not just today's: it has no tools to look.
  const d = new Draft(req);
  const free = d.free().map((x) => d.at(x));
  const text = `Facts:\n${brief(d)}\nAll free time from now on, before any change: ${free.join(", ") || "none"}.\n\nChanges:\n${changesText(req, res)}\n\nMessage:\n${res.message}`;
  return runTask(judgeTask, [{ type: "input_text", text }], { env: readEnv(), log: () => {} });
}

/** What the case says a good rebuild must do, and what this one didn't. */
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
  if (e.not_before)
    for (const x of res.diff)
      if (x.action === "move" && Date.parse(x.start!) < at(req, e.not_before)) out.push(`${x.item_id} before ${e.not_before}`); // prettier-ignore
  const changed = res.diff.filter((x) => x.action !== "keep").length;
  if (changed > e.max_changes) out.push(`${changed} changes, at most ${e.max_changes}`);
  for (const id of e.keep ?? []) if (by.get(id)?.action !== "keep") out.push(`${id} should stay`);
  for (const id of e.changed ?? []) if (by.get(id)?.action === "keep") out.push(`${id} should move or drop`);
  return out;
}

mkdirSync(REC, { recursive: true });
const cases = REBUILD_CASES.filter((c) => !only || c.name === only);
let spent = 0;
const rows: {
  name: string;
  agent: string[];
  invalid: string[];
  unkind: boolean;
  fallback: string[];
  rec: Recording | null;
}[] = [];

for (const c of cases) {
  const req = RebuildRequest.parse(c.request);
  const reqSha = sha(req);
  let rec: Recording | null = existsSync(recPath(c)) ? JSON.parse(readFileSync(recPath(c), "utf8")) : null;
  const stale =
    !rec || rec.agent_version !== REBUILD_VERSION || rec.request_sha !== reqSha || (args.includes("--effort") && rec.effort !== effort); // prettier-ignore
  if (live && (stale || force)) {
    const run = await rebuild(req, { effort, log: () => {} });
    rec = {
      agent_version: REBUILD_VERSION,
      judge_version: judgeTask.version,
      request_sha: reqSha,
      effort,
      response: RebuildResponse.parse(run.response),
      turns: run.turns,
      refused: run.refused,
      refusals: run.refusals,
      fell_back: run.fellBack,
      calls: lines(run.calls),
      judge: null,
      judge_calls: [],
    };
    spent += run.calls.reduce((a, x) => a + x.costUsd, 0);
  }
  if (live && rec && (rec.judge === null || rec.judge_version !== judgeTask.version || force)) {
    const j = await judge(req, rec.response).catch((e: Error) => {
      console.log(`  ${c.name}: judge failed (${e.name}: ${e.message.slice(0, 200)})`);
      return null;
    });
    rec.judge = j?.data ?? null;
    rec.judge_version = judgeTask.version;
    rec.judge_calls = j ? lines(j.calls) : [];
    spent += j ? j.calls.reduce((a, x) => a + x.costUsd, 0) : 0;
  }
  if (live && rec) writeFileSync(recPath(c), JSON.stringify(rec, null, 2) + "\n");
  const fb = fallback(req).response("fallback");
  rows.push({
    name: c.name,
    agent: rec ? misses(c, rec.response) : ["not recorded (run pnpm eval:rebuild:live)"],
    invalid: rec ? checkResponse(req, rec.response) : [],
    unkind: rec ? unkind(rec.response.message) : false,
    fallback: [...misses(c, fb), ...checkResponse(req, fb)],
    rec,
  });
  if (verbose && rec) {
    console.log(`\n${c.name}: ${c.about}\n  ${rec.response.message}`);
    console.log(`  judge ${rec.judge?.score ?? "-"} ${rec.judge?.problems.join("; ") ?? ""}`);
    console.log(`  turns ${rec.turns}, refused ${rec.refused}, fell back: ${rec.fell_back ?? "no"}`);
    for (const r of rec.refusals ?? []) console.log(`    refused ${r}`);
  }
}

const recs = rows.flatMap((r) => (r.rec ? [r.rec] : []));
const calls = recs.flatMap((r) => r.calls);
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const n = rows.length;
const judged = recs.flatMap((r) => (r.judge ? [r.judge.score] : []));
const tokensIn = sum(calls.map((x) => x.usage.input_tokens));
const headline = {
  cases: n,
  effort: recs[0]?.effort ?? effort,
  rebuilds_right: `${rows.filter((r) => r.rec && !r.agent.length).length}/${n}`,
  invalid_moves: sum(rows.map((r) => r.invalid.length)),
  unkind_messages: rows.filter((r) => r.unkind).length,
  judge_score: judged.length ? Number((sum(judged) / judged.length).toFixed(2)) : null,
  judged: `${judged.length}/${n}`,
  fell_back: `${recs.filter((r) => r.fell_back).length}/${recs.length}`,
  turns_per_rebuild: recs.length ? Number((sum(recs.map((r) => r.turns)) / recs.length).toFixed(1)) : 0,
  refused_tool_calls: sum(recs.map((r) => r.refused)),
  cost_per_rebuild: recs.length ? Number((sum(calls.map((x) => x.costUsd)) / recs.length).toFixed(5)) : 0,
  tokens_per_call: calls.length
    ? `${Math.round(tokensIn / calls.length)} in, ${Math.round(sum(calls.map((x) => x.usage.output_tokens)) / calls.length)} out`
    : "-",
  cache_hit_rate: tokensIn ? `${Math.round((100 * sum(calls.map((x) => x.usage.cached_tokens))) / tokensIn)}%` : "-",
  latency_per_rebuild_s: recs.length ? Number((sum(calls.map((x) => x.latencyMs)) / recs.length / 1000).toFixed(1)) : 0,
  fallback_rebuilds_right: `${rows.filter((r) => !r.fallback.length).length}/${n}`,
};

console.log(`\nRebuild evals: ${n} cases, effort ${headline.effort}`);
console.log(`${"".padEnd(26)}${"agent".padEnd(12)}code fallback`);
console.log(`${"Rebuilds right".padEnd(26)}${headline.rebuilds_right.padEnd(12)}${headline.fallback_rebuilds_right}`);
console.log(`${"Invalid moves".padEnd(26)}${headline.invalid_moves}`);
console.log(`${"Unkind messages".padEnd(26)}${headline.unkind_messages}`);
console.log(`${"Judge score (1-5)".padEnd(26)}${headline.judge_score ?? "-"}   (${headline.judged} judged)`);
console.log(`${"Fell back to code".padEnd(26)}${headline.fell_back}`);
console.log(`${"Turns per rebuild".padEnd(26)}${headline.turns_per_rebuild}   (${headline.refused_tool_calls} tool calls refused)`); // prettier-ignore
console.log(`${"Model cost per rebuild".padEnd(26)}$${headline.cost_per_rebuild.toFixed(4)}   (${headline.latency_per_rebuild_s}s of model time)`); // prettier-ignore
console.log(`Tokens per call: ${headline.tokens_per_call}; prompt cache hit rate ${headline.cache_hit_rate}`);
for (const r of rows) {
  const bad = [...r.agent, ...r.invalid.map((x) => `invalid: ${x}`), ...(r.unkind ? ["unkind words"] : [])];
  if (bad.length) console.log(`  ${r.name}: ${bad.join("; ")}`);
}
if (spent) console.log(`Model spend this run: $${spent.toFixed(4)}`);

if (!only)
  writeFileSync(
    RESULTS,
    JSON.stringify(
      {
        headline,
        cases: rows.map((r) => ({
          name: r.name,
          right: !!r.rec && !r.agent.length,
          misses: r.agent,
          judge: r.rec?.judge ?? null,
          fallback_misses: r.fallback,
        })),
      },
      null,
      2,
    ) + "\n",
  );

// The promises: no move Tomorrow would have to refuse, no unkind words, and every case recorded.
if (headline.invalid_moves > 0 || headline.unkind_messages > 0 || recs.length < n) process.exitCode = 1;
