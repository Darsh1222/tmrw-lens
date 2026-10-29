// Runs the eval cases in evals/cases/ and reports the headline numbers:
// "% fully verified" and "invented dates". Also: items found, dates right,
// conflicts caught (with the right answer pre-selected), and false conflicts.
//
//   pnpm eval            replays recorded model readings (free, offline, runs in CI)
//   pnpm eval:live       re-reads every fixture with Meta Model API, records it, then scores (about 30 cents)
//   pnpm eval -- --case conflict-date --verbose
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { readEnv } from "@/lib/env";
import { readSource, type PageInput } from "@/lib/extract/read";
import { notesTask, rereadTask, scheduleTask, syllabusPageTask, whiteboardTask } from "@/lib/extract/tasks";
import { auditPlan } from "@/lib/plan/audit";
import { buildPlan } from "@/lib/plan/build";
import { familyOf } from "@/lib/plan/courses";
import type { Plan, PlanItem, SourceMeta, SourceReading } from "@/lib/plan/types";
import { parseDays } from "@/lib/resolve/dates";
import type { SourceKind } from "@/lib/schemas/evidence";
import { renderPdfPages } from "./lib/render-pdf";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "synthetic");
const CASES = join(ROOT, "evals", "cases");
const REC = join(ROOT, "evals", "recorded");

const args = process.argv.slice(2);
const live = args.includes("--live");
const verbose = args.includes("--verbose");
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;

type GoldItem = {
  course: string | null;
  title: string;
  match?: string;
  date: string | null;
  time: string | null;
  end: string | null;
  sources?: number;
  conflict?: boolean;
};
type GoldConflict = { title: string; course: string; fields: string[]; options: string[]; suggested: string };
type Case = {
  name: string;
  description: string;
  zone: string;
  added_at: string;
  sources: string[];
  expect: {
    term_start: string | null;
    classes: { course: string; type: string; days: string; start: string; end: string }[];
    items: GoldItem[];
    conflicts: GoldConflict[];
    crossed_out: string[];
    overlaps: string[];
  };
};
type Manifest = Record<string, { kind: SourceKind; label: string; captured_at: string | null }>;
type Recording = {
  file: string;
  sha256: string;
  model: string;
  tasks: Record<string, number>;
  pages: SourceReading["pages"];
};

const manifest = JSON.parse(readFileSync(join(FIX, "manifest.json"), "utf8")) as Manifest;
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(CASES, f), "utf8")) as Case)
  .filter((c) => !only || c.name === only);
if (!cases.length) throw new Error(`no case named ${only}`);

const TASK_VERSIONS = Object.fromEntries(
  [scheduleTask, syllabusPageTask, whiteboardTask, notesTask, rereadTask(1)].map((t) => [t.name, t.version]),
);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const recPath = (file: string) => join(REC, `${file}.json`);

function meta(file: string, addedAt: string): SourceMeta {
  const m = manifest[file];
  if (!m) throw new Error(`${file} isn't in fixtures/synthetic/manifest.json`);
  return { id: file, kind: m.kind, label: m.label, captured_at: m.captured_at, added_at: addedAt };
}

async function pagesOf(file: string): Promise<PageInput[]> {
  const bytes = readFileSync(join(FIX, file));
  const ext = extname(file);
  if (ext === ".txt") return [{ page: null, image: null, text: bytes.toString("utf8") }];
  if (ext === ".pdf")
    return (await renderPdfPages(new Uint8Array(bytes))).map((p) => ({
      page: p.page,
      image: new Uint8Array(p.png),
      mime: "image/png" as const,
      text: p.text,
    }));
  return [{ page: null, image: new Uint8Array(bytes), mime: ext === ".png" ? "image/png" : "image/jpeg", text: null }];
}

let spent = 0;
async function record(file: string) {
  const env = readEnv();
  const { reading, calls } = await readSource(meta(file, "2026-10-29T09:00:00-04:00"), await pagesOf(file), {
    log: () => {},
  });
  const cost = calls.reduce((s, c) => s + c.costUsd, 0);
  spent += cost;
  const rec: Recording = {
    file,
    sha256: sha(readFileSync(join(FIX, file))),
    model: env.MUSE_SPARK_MODEL,
    tasks: TASK_VERSIONS,
    pages: reading.pages,
  };
  writeFileSync(recPath(file), JSON.stringify(rec, null, 2) + "\n");
  console.log(`  recorded ${file}: ${calls.length} calls, $${cost.toFixed(4)}`);
}

function load(file: string, addedAt: string): SourceReading {
  let rec: Recording;
  try {
    rec = JSON.parse(readFileSync(recPath(file), "utf8")) as Recording;
  } catch {
    throw new Error(`no recording for ${file}; run pnpm eval:live`);
  }
  if (rec.sha256 !== sha(readFileSync(join(FIX, file))))
    throw new Error(`${file} changed since it was recorded; run pnpm eval:live`);
  for (const [name, v] of Object.entries(TASK_VERSIONS))
    if (rec.tasks[name] !== undefined && rec.tasks[name] !== v)
      throw new Error(`${file} was recorded with ${name}@v${rec.tasks[name]}; run pnpm eval:live`);
  return { source: meta(file, addedAt), pages: rec.pages };
}

// Scoring.
const titleMatches = (gold: GoldItem, item: PlanItem) => {
  if (gold.course && item.course !== gold.course) return false;
  if (gold.match) return new RegExp(gold.match, "i").test(item.title);
  const g = familyOf(gold.title);
  return g.family
    ? g.family === item.family && g.number === item.number
    : item.title.toLowerCase() === gold.title.toLowerCase();
};

type Score = {
  name: string;
  things: number;
  verified: number;
  status: Record<string, number>;
  goldItems: number;
  found: number;
  extra: string[];
  missed: string[];
  dates: number;
  datesRight: number;
  wrong: string[];
  invented: string[];
  datesAudited: number;
  conflictsExpected: number;
  conflictsCaught: number;
  suggestedRight: number;
  falseConflicts: string[];
  classesRight: number;
  classesExpected: number;
  notes: string[];
};

function score(c: Case, plan: Plan, sources: SourceMeta[]): Score {
  const s: Score = {
    name: c.name, things: 0, verified: 0, status: {}, goldItems: c.expect.items.length, found: 0, extra: [],
    missed: [], dates: 0, datesRight: 0, wrong: [], invented: [], datesAudited: 0,
    conflictsExpected: c.expect.conflicts.length, conflictsCaught: 0, suggestedRight: 0, falseConflicts: [],
    classesRight: 0, classesExpected: c.expect.classes.length, notes: [],
  }; // prettier-ignore

  for (const thing of [...plan.items, ...plan.classes]) {
    s.things++;
    s.status[thing.status] = (s.status[thing.status] ?? 0) + 1;
    if (thing.status === "verified") s.verified++;
  }

  // Classes: course, meeting type, days, and times all have to match.
  const unmatchedClasses = [...plan.classes];
  for (const g of c.expect.classes) {
    const days = parseDays(g.days)!.join();
    const i = unmatchedClasses.findIndex(
      (k) =>
        k.course === g.course &&
        k.meeting_type === g.type &&
        k.days.join() === days &&
        k.start === g.start &&
        k.end === g.end,
    );
    if (i >= 0) {
      s.classesRight++;
      unmatchedClasses.splice(i, 1);
    } else s.notes.push(`class missed: ${g.course} ${g.type} ${g.days} ${g.start}-${g.end}`);
  }
  for (const k of unmatchedClasses)
    s.notes.push(`class extra: ${k.course} ${k.meeting_type} ${k.days.join("")} ${k.start}-${k.end}`);

  // Items: one-to-one by course and title (or family and number).
  const left = [...plan.items];
  for (const g of c.expect.items) {
    const i = left.findIndex((item) => titleMatches(g, item));
    if (i < 0) {
      s.missed.push(g.title);
      continue;
    }
    const item = left.splice(i, 1)[0];
    s.found++;
    if (g.sources && item.evidence.length !== g.sources)
      s.notes.push(`${g.title}: ${item.evidence.length} sources, expected ${g.sources}`);
    if (g.conflict) {
      if (!item.conflict) s.notes.push(`${g.title}: expected a conflict`);
      continue;
    }
    if (g.date) {
      s.dates++;
      const got = item.date?.value ?? null;
      const timeOk = !g.time || (item.time?.start === g.time && (item.time?.end ?? null) === g.end);
      if (got === g.date && timeOk) s.datesRight++;
      else if (got !== null && got !== g.date) s.wrong.push(`${g.title}: ${got}, expected ${g.date}`);
      else if (got !== null)
        s.wrong.push(`${g.title}: ${item.time?.start}-${item.time?.end}, expected ${g.time}-${g.end}`);
      else
        s.notes.push(
          `${g.title}: no date yet (${item.status}: ${item.checks.date.reason ?? item.checks.quote.reason})`,
        );
    }
  }
  s.extra = left.map((i) => i.title);

  // Conflicts: caught, with the same options, and the right answer pre-selected.
  for (const g of c.expect.conflicts) {
    const item = plan.items.find(
      (i) => i.conflict && i.course === g.course && titleMatches({ ...g, date: null, time: null, end: null }, i),
    );
    const q = item && plan.questions.find((x) => x.about === item.id && x.type === "conflict");
    if (!item || !q) {
      s.notes.push(`conflict missed: ${g.title}`);
      continue;
    }
    const values = q.options.map((o) => o.value).filter((v) => v !== "different");
    if (JSON.stringify([...values].sort()) === JSON.stringify([...g.options].sort())) s.conflictsCaught++;
    else s.notes.push(`${g.title}: conflict options ${values.join(", ")}`);
    if (q.options.find((o) => o.id === q.suggested)?.value === g.suggested) s.suggestedRight++;
    else s.notes.push(`${g.title}: pre-selected the wrong version`);
  }
  for (const i of plan.items)
    if (i.conflict && !c.expect.conflicts.some((g) => titleMatches({ ...g, date: null, time: null, end: null }, i)))
      s.falseConflicts.push(i.title);
  for (const o of c.expect.overlaps)
    if (!plan.questions.some((q) => q.type === "class_overlap" && q.prompt.startsWith(o)))
      s.notes.push(`overlap missed: ${o}`);
  for (const x of c.expect.crossed_out)
    if (!plan.crossed_out.some((k) => new RegExp(x, "i").test(k.title)))
      s.notes.push(`crossed-out line not set aside: ${x}`);
  if ((plan.term_start.date?.value ?? null) !== c.expect.term_start)
    s.notes.push(`term start ${plan.term_start.date?.value ?? "none"}, expected ${c.expect.term_start ?? "none"}`);

  const audit = auditPlan(plan, sources);
  s.datesAudited = audit.dates;
  s.invented = audit.invented.map((f) => `${f.about} ${f.field} ${f.value}: ${f.why}`);
  return s;
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");

if (live) {
  const files = [...new Set(cases.flatMap((c) => c.sources))];
  console.log(`Recording ${files.length} fixtures with ${readEnv().MUSE_SPARK_MODEL}...`);
  for (const f of files) await record(f);
}

const scores: Score[] = [];
for (const c of cases) {
  const readings = c.sources.map((f) => load(f, c.added_at));
  const plan = buildPlan(readings, { zone: c.zone });
  const s = score(
    c,
    plan,
    readings.map((r) => r.source),
  );
  scores.push(s);
  const flag = s.invented.length || s.notes.some((n) => n.startsWith("conflict")) ? "✗" : "✓";
  console.log(
    `${flag} ${c.name.padEnd(20)} verified ${String(s.verified).padStart(2)}/${String(s.things).padEnd(3)} found ${s.found}/${s.goldItems + 0}` +
      `${s.classesExpected ? ` classes ${s.classesRight}/${s.classesExpected}` : ""} dates ${s.datesRight}/${s.dates}` +
      `${s.conflictsExpected ? ` conflicts ${s.conflictsCaught}/${s.conflictsExpected} (pre-selected right ${s.suggestedRight})` : ""}` +
      `${s.falseConflicts.length ? ` false conflicts: ${s.falseConflicts.join(", ")}` : ""} invented ${s.invented.length}`,
  );
  if (verbose || s.invented.length) {
    for (const x of [
      ...s.invented,
      ...s.wrong,
      ...s.missed.map((m) => `missed: ${m}`),
      ...s.extra.map((e) => `extra: ${e}`),
      ...s.notes,
    ])
      console.log(`    ${x}`);
    if (verbose)
      for (const q of plan.questions)
        console.log(
          `    ? [${q.type}] ${q.prompt}${q.suggested ? ` → pre-selected ${q.options.find((o) => o.id === q.suggested)?.label}` : ""}${q.why_suggested ? ` (${q.why_suggested})` : ""}`,
        );
  }
}

const sum = (k: keyof Score) => scores.reduce((a, s) => a + (s[k] as number), 0);
const invented = scores.reduce((a, s) => a + s.invented.length, 0);
const statusTotals: Record<string, number> = {};
for (const s of scores) for (const [k, v] of Object.entries(s.status)) statusTotals[k] = (statusTotals[k] ?? 0) + v;
const headline = {
  cases: scores.length,
  fully_verified: `${sum("verified")}/${sum("things")} (${pct(sum("verified"), sum("things"))})`,
  invented_dates: `${invented} of ${sum("datesAudited")} dates audited`,
  items_found: `${sum("found")}/${sum("goldItems")}`,
  classes_right: `${sum("classesRight")}/${sum("classesExpected")}`,
  dates_right: `${sum("datesRight")}/${sum("dates")}`,
  wrong_dates: scores.reduce((a, s) => a + s.wrong.length, 0),
  conflicts_caught: `${sum("conflictsCaught")}/${sum("conflictsExpected")}`,
  conflict_answer_preselected_right: `${sum("suggestedRight")}/${sum("conflictsExpected")}`,
  false_conflicts: scores.reduce((a, s) => a + s.falseConflicts.length, 0),
  status: statusTotals,
};
console.log(`
Fully verified:   ${headline.fully_verified} of everything found (classes and items)
Invented dates:   ${headline.invented_dates}
Items found:      ${headline.items_found}   classes ${headline.classes_right}   dates right ${headline.dates_right}   wrong dates ${headline.wrong_dates}
Conflicts caught: ${headline.conflicts_caught}   right answer pre-selected ${headline.conflict_answer_preselected_right}   false conflicts ${headline.false_conflicts}
Status:           ${Object.entries(statusTotals)
  .map(([k, v]) => `${k} ${v}`)
  .join(", ")}`);
if (live) console.log(`Model spend this run: $${spent.toFixed(4)}`);

if (!only) {
  writeFileSync(join(ROOT, "evals", "results.json"), JSON.stringify({ headline, cases: scores }, null, 2) + "\n");
}
// The two promises the demo makes, and the two deliberate conflicts, fail the run if broken.
const conflictMiss =
  sum("conflictsCaught") < sum("conflictsExpected") || sum("suggestedRight") < sum("conflictsExpected");
if (invented > 0 || conflictMiss) process.exitCode = 1;
