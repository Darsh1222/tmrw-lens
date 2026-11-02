// Scores text-a-photo (/api/extract) on evals/extract/cases.ts: precision and
// recall of what's auto-applied (the gold list per case), invented dates (CI
// fails on any), changes to existing items caught with the right new date,
// duplicates recognized, and questions instead of guesses on a blurry photo.
// Scored twice per case: as first returned, and after the person's answers.
//
//   pnpm eval:extract          replays recorded readings (free, offline, runs in CI)
//   pnpm eval:extract:live     re-reads photos whose recording is missing or stale, then scores (about 5 cents)
//   pnpm eval:extract -- --verbose
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readEnv } from "@/lib/env";
import { KIND_LABEL } from "@/lib/extract/kinds";
import { CROP_VERSION } from "@/lib/extract/read";
import { classifyTask, rereadTask, taskFor } from "@/lib/extract/tasks";
import type { CallResult } from "@/lib/meta/client";
import { auditPlan } from "@/lib/plan/audit";
import { norm } from "@/lib/plan/text";
import type { PageReading } from "@/lib/plan/types";
import { kvFor } from "@/lib/server/kv";
import { readPhotos } from "@/lib/server/photos";
import { assemble, ExtractResponse, planOf, type ExtractState, type PhotoInfo } from "@/lib/tomorrow/extract";
import { EXTRACT_CASES, type ExtractCase, type Expected } from "../evals/extract/cases";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "synthetic");
const REC = join(ROOT, "evals", "extract", "recorded");
const RESULTS = join(ROOT, "evals", "extract", "results.json");
const args = process.argv.slice(2);
const live = args.includes("--live");
const force = args.includes("--force");
const verbose = args.includes("--verbose");
const ZONE = "America/New_York";
const REVIEW = { url: "https://lens.example/review/eval", expires_at: "2026-11-02T00:00:00.000Z" };

type CallLine = Pick<CallResult, "usage" | "costUsd" | "latencyMs">;
type Recording = {
  image_sha: string;
  versions: string;
  photo: PhotoInfo;
  page: PageReading | null;
  taken_at: string | null;
  calls: CallLine[];
};

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const versionsFor = (kind: string | null) =>
  [classifyTask.version, kind && kind !== "other" ? taskFor(kind as never).version : "-", rereadTask(1).version, CROP_VERSION].join("|"); // prettier-ignore

async function record(file: string): Promise<Recording> {
  const bytes = new Uint8Array(readFileSync(join(FIX, file)));
  const path = join(REC, `${file}.json`);
  const old: Recording | null = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  const stale = !old || old.image_sha !== sha(bytes) || old.versions !== versionsFor(old.photo.kind);
  if (old && !stale && !force) return old;
  if (!live) throw new Error(`${file}: no current recording; run pnpm eval:extract:live`);
  const env = readEnv();
  const now = new Date().toISOString();
  const r = await readPhotos([bytes], { env, kv: kvFor({ ...env, UPSTASH_REDIS_REST_URL: undefined }), now });
  const rec: Recording = {
    image_sha: sha(bytes),
    versions: versionsFor(r.photos[0].kind),
    photo: r.photos[0],
    page: r.readings[0]?.pages[0] ?? null,
    taken_at: r.readings[0]?.source.captured_at ?? null,
    calls: r.calls.map(({ usage, costUsd, latencyMs }) => ({ usage, costUsd, latencyMs })),
  };
  writeFileSync(path, JSON.stringify(rec, null, 2) + "\n");
  spent += rec.calls.reduce((a, c) => a + c.costUsd, 0);
  return rec;
}

function stateFor(c: ExtractCase, recs: Recording[], answers = c.answers): ExtractState {
  return {
    version: 1,
    zone: ZONE,
    now: c.now,
    readings: recs.flatMap((r, i) => {
      if (!r.page || r.photo.kind === "other") return [];
      const kind = r.photo.kind;
      return [
        {
          source: { id: `photo${i + 1}`, kind, label: kind === "syllabus_pdf" ? "syllabus photo" : KIND_LABEL[kind], captured_at: r.taken_at, added_at: c.now }, // prettier-ignore
          pages: [r.page],
        },
      ];
    }),
    photos: recs.map((r, i) => ({ ...r.photo, index: i })),
    existing: c.existing,
    term: c.term,
    answers,
  };
}

const same = (x: Expected, i: ExtractResponse["items"][number]) =>
  i.kind !== "class_block" && (norm(i.title).includes(norm(x.title)) || norm(x.title).includes(norm(i.title)));

type Score = {
  auto: number;
  autoRight: number;
  gold: number;
  goldFound: number;
  invented: number;
  dates: number;
  changesExpected: number;
  changesRight: number;
  changesAutoBeforeAnswer: number;
  duplicatesExpected: number;
  duplicatesRight: number;
  questions: number;
  misses: string[];
};

function score(c: ExtractCase, res: ExtractResponse, state: ExtractState, first: ExtractResponse): Score {
  const { plan, sources } = planOf(state);
  const audit = auditPlan(plan, sources);
  const auto = res.items.filter((i) => i.auto_apply && i.kind !== "class_block");
  const misses: string[] = [];
  let autoRight = 0;
  for (const i of auto) {
    if (i.kind === "class_block") continue;
    const x = [...c.expect.auto_apply, ...(c.expect.optional ?? [])].find((g) => same(g, i));
    if (x && x.date === i.date && x.time === i.start_time) autoRight += 1;
    else misses.push(`auto-applied ${i.title} ${i.date ?? "-"} ${i.start_time ?? "-"}${x ? `, expected ${x.date} ${x.time ?? "-"}` : ", not expected"}`); // prettier-ignore
  }
  let goldFound = 0;
  for (const g of c.expect.auto_apply) {
    const i = auto.find((a) => same(g, a));
    if (i && i.kind !== "class_block" && i.date === g.date && i.start_time === g.time) goldFound += 1;
    else if (!i) misses.push(`not auto-applied: ${g.title}`);
  }
  let changesRight = 0;
  for (const x of c.expect.changes ?? []) {
    const ch = res.changes.find((k) => k.existing_id === x.existing_id);
    if (ch && ch.to.date === x.to && ch.kind === x.kind) changesRight += 1;
    else misses.push(`change ${x.existing_id} → ${x.to}: ${ch ? `${ch.to.date} ${ch.kind}` : "not found"}`);
  }
  let duplicatesRight = 0;
  for (const id of c.expect.duplicates ?? []) {
    if (res.duplicates.some((d) => d.existing_id === id)) duplicatesRight += 1;
    else misses.push(`duplicate ${id} not recognized`);
  }
  if ((c.expect.min_questions ?? 0) > res.questions.length) misses.push(`${res.questions.length} questions`);
  return {
    auto: auto.length,
    autoRight,
    gold: c.expect.auto_apply.length,
    goldFound,
    invented: audit.invented.length,
    dates: audit.dates,
    changesExpected: c.expect.changes?.length ?? 0,
    changesRight,
    // A change is never applied before the person answers.
    changesAutoBeforeAnswer: first.changes.filter((k) => k.auto_apply).length,
    duplicatesExpected: c.expect.duplicates?.length ?? 0,
    duplicatesRight,
    questions: res.questions.length,
    misses,
  };
}

mkdirSync(REC, { recursive: true });
let spent = 0;
const recordings = new Map<string, Recording>();
const rows: { name: string; s: Score; summary: string }[] = [];
for (const c of EXTRACT_CASES) {
  const recs: Recording[] = [];
  for (const f of c.images) {
    if (!recordings.has(f)) recordings.set(f, await record(f));
    recs.push(recordings.get(f)!);
  }
  const first = ExtractResponse.parse(assemble(stateFor(c, recs, []), REVIEW));
  const state = stateFor(c, recs);
  const final = ExtractResponse.parse(assemble(state, REVIEW));
  const s = score(c, final, state, first);
  rows.push({ name: c.name, s, summary: first.summary });
  if (verbose) {
    console.log(`\n${c.name}: ${c.about}`);
    console.log(`  photo: ${recs.map((r) => `${r.photo.kind} (${r.photo.readable})`).join(", ")}`);
    console.log(`  first text: ${first.summary}`);
    for (const q of first.questions) console.log(`  question: ${q.text}`);
    for (const i of final.items) console.log(`  item: ${i.title} ${i.kind === "class_block" ? "" : `${i.date ?? "-"} ${i.start_time ?? "-"}`} ${i.status}${i.auto_apply ? " auto" : ""}`); // prettier-ignore
    for (const k of final.changes)
      console.log(`  change: ${k.title} ${k.from.date} → ${k.to.date} (${k.kind}, ${k.status})`);
  }
}

const sum = (k: keyof Score) => rows.reduce((a, r) => a + (r.s[k] as number), 0);
const calls = [...recordings.values()].flatMap((r) => r.calls);
const tokensIn = calls.reduce((a, c) => a + c.usage.input_tokens, 0);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-");
const headline = {
  cases: rows.length,
  auto_applied_right: `${sum("autoRight")}/${sum("auto")}`,
  precision: pct(sum("autoRight"), sum("auto")),
  recall: pct(sum("goldFound"), sum("gold")),
  invented_dates: `${sum("invented")} of ${sum("dates")}`,
  changes_caught: `${sum("changesRight")}/${sum("changesExpected")}`,
  changes_applied_before_answer: sum("changesAutoBeforeAnswer"),
  duplicates_recognized: `${sum("duplicatesRight")}/${sum("duplicatesExpected")}`,
  cost_per_photo: Number((calls.reduce((a, c) => a + c.costUsd, 0) / recordings.size).toFixed(5)),
  calls_per_photo: Number((calls.length / recordings.size).toFixed(1)),
  tokens_per_call: calls.length
    ? `${Math.round(tokensIn / calls.length)} in, ${Math.round(calls.reduce((a, c) => a + c.usage.output_tokens, 0) / calls.length)} out` // prettier-ignore
    : "-",
};

console.log(`\nText-a-photo evals: ${rows.length} cases, ${recordings.size} photos`);
console.log(`${"Auto-applied, right".padEnd(30)}${headline.auto_applied_right}  (precision ${headline.precision})`);
console.log(`${"Gold items auto-applied".padEnd(30)}recall ${headline.recall}`);
console.log(`${"Invented dates".padEnd(30)}${headline.invented_dates}`);
console.log(`${"Changes caught".padEnd(30)}${headline.changes_caught}  (applied before an answer: ${headline.changes_applied_before_answer})`); // prettier-ignore
console.log(`${"Duplicates recognized".padEnd(30)}${headline.duplicates_recognized}`);
console.log(
  `${"Model cost per photo".padEnd(30)}$${headline.cost_per_photo.toFixed(4)}  (${headline.calls_per_photo} calls)`,
);
console.log(`Tokens per call: ${headline.tokens_per_call}`);
for (const r of rows) if (r.s.misses.length) console.log(`  ${r.name}: ${r.s.misses.join("; ")}`);
if (spent) console.log(`Model spend this run: $${spent.toFixed(4)}`);

writeFileSync(
  RESULTS,
  JSON.stringify({ headline, cases: rows.map((r) => ({ name: r.name, ...r.s, first_text: r.summary })) }, null, 2) +
    "\n",
);
// The promises: no invented date, nothing wrong auto-applied, no change applied before the person answers.
if (sum("invented") > 0 || sum("autoRight") < sum("auto") || sum("changesAutoBeforeAnswer") > 0) process.exitCode = 1;
