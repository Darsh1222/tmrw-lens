// Runs the eval cases and reports the headline numbers, "% fully verified" and
// "invented dates", twice: with the second read on SAM object crops, and
// without SAM (box crops), from the same first read. Also: items found, dates
// right, conflicts caught (with the right answer pre-selected), false
// conflicts, dates after answering questions, and model cost per photo.
//
//   pnpm eval            replays recorded model readings (free, offline, runs in CI)
//   pnpm eval:live       re-reads fixtures whose recording is missing or stale (input, task version, or crops
//                        changed), records them, then scores; --force re-reads all (about 22 cents)
//   pnpm eval -- --case conflict-date --verbose
//   pnpm eval:real       your own photos in local-inputs/ (git-ignored): records once, then replays; numbers only
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { DateTime } from "luxon";
import { readEnv } from "@/lib/env";
import {
  CROP_VERSION,
  extractPage,
  rereadPage,
  SEGMENTED_KINDS,
  segmentPage,
  type PageInput,
} from "@/lib/extract/read";
import { notesTask, rereadTask, scheduleTask, syllabusPageTask, taskFor, whiteboardTask } from "@/lib/extract/tasks";
import { preparePhoto, readExif } from "@/lib/images/prepare";
import type { CallResult } from "@/lib/meta/client";
import { answerQuestion } from "@/lib/plan/answer";
import { auditPlan } from "@/lib/plan/audit";
import { buildPlan } from "@/lib/plan/build";
import { familyOf } from "@/lib/plan/courses";
import type { PageReading, Plan, PlanItem, Reread, SceneObject, SourceMeta, SourceReading } from "@/lib/plan/types";
import { parseDays } from "@/lib/resolve/dates";
import type { SourceKind } from "@/lib/schemas/evidence";
import { renderPdfPages } from "./lib/render-pdf";

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const live = args.includes("--live");
const force = args.includes("--force");
const real = args.includes("--real");
const verbose = args.includes("--verbose");
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;

const LOCAL = join(ROOT, "local-inputs");
const FIX = real ? LOCAL : join(ROOT, "fixtures", "synthetic");
const CASES = real ? join(LOCAL, "cases") : join(ROOT, "evals", "cases");
const REC = real ? join(LOCAL, ".recorded") : join(ROOT, "evals", "recorded");
const RESULTS = real ? join(LOCAL, "results.json") : join(ROOT, "evals", "results.json");
const ZONE = "America/New_York";

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
type Expect = {
  term_start: string | null;
  term_end?: string | null;
  /** First and last day of each break the sources list; [] when none do (then Lens should ask, if there are classes). */
  breaks?: [string, string][];
  classes: { course: string; type: string; days: string; start: string; end: string }[];
  items: GoldItem[];
  conflicts: GoldConflict[];
  crossed_out: string[];
  overlaps: string[];
};
type Case = {
  name: string;
  description: string;
  zone: string;
  added_at: string;
  sources: string[];
  /** Real photos may have no gold: then only the two headline numbers are scored. */
  expect?: Expect;
  /** Answer questions, then check where items landed: dependents move with what they depend on. */
  then?: { answer: { conflict: string; pick: string }[]; items: GoldItem[] };
};
type Meta = { kind: SourceKind; label: string; captured_at: string | null };

type Stage = { calls: number; input_tokens: number; cached_tokens: number; output_tokens: number; cost_usd: number };
const STAGES = ["extract", "reread_box", "sam_segment", "reread_sam"] as const;
type StageName = (typeof STAGES)[number];
type RecPage = Omit<PageReading, "objects"> & {
  sam: { objects: SceneObject[]; rereads: Record<string, Reread> } | null;
};
type Recording = {
  file: string;
  sha256: string;
  model: string;
  sam_model: string;
  tasks: Record<string, number>;
  crops: number;
  added_at: string;
  pages: RecPage[];
  stages: Record<StageName, Stage>;
};

const TASK_VERSIONS = Object.fromEntries(
  [scheduleTask, syllabusPageTask, whiteboardTask, notesTask, rereadTask(1)].map((t) => [t.name, t.version]),
);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const recPath = (file: string) => join(REC, `${file}.json`);

// What each input is. Fixtures say so in their manifest; real photos say so in local-inputs/inputs.json, or
// by name ("whiteboard...", "testudo...", "*.pdf"), with the capture time from EXIF.
const IMAGE = /\.(jpe?g|png|heic)$/i;
function realFiles(): string[] {
  if (!existsSync(LOCAL)) return [];
  return readdirSync(LOCAL)
    .filter((f) => IMAGE.test(f) || /\.(pdf|txt)$/i.test(f))
    .sort();
}
function metaOf(file: string): Meta {
  if (!real) {
    const m = (JSON.parse(readFileSync(join(FIX, "manifest.json"), "utf8")) as Record<string, Meta>)[file];
    if (!m) throw new Error(`${file} isn't in fixtures/synthetic/manifest.json`);
    return m;
  }
  const listed = existsSync(join(LOCAL, "inputs.json"))
    ? (JSON.parse(readFileSync(join(LOCAL, "inputs.json"), "utf8")) as Record<string, Partial<Meta>>)[file]
    : undefined;
  const n = file.toLowerCase();
  const kind: SourceKind =
    listed?.kind ??
    (n.endsWith(".pdf")
      ? "syllabus_pdf"
      : n.endsWith(".txt")
        ? "testudo_text"
        : /testudo|schedule|screen ?shot/.test(n)
          ? "testudo_screenshot"
          : /board/.test(n)
            ? "whiteboard_photo"
            : "notes_photo");
  const label = listed?.label ?? (kind === "whiteboard_photo" ? "whiteboard photo" : kind === "notes_photo" ? "notes photo" : kind === "syllabus_pdf" ? "syllabus" : "Testudo schedule"); // prettier-ignore
  let captured = listed?.captured_at ?? null;
  if (captured === null && IMAGE.test(file) && !/\.heic$/i.test(file)) {
    const taken = readExif(new Uint8Array(readFileSync(join(LOCAL, file)))).takenAt;
    if (taken) captured = DateTime.fromISO(taken, { zone: ZONE, setZone: /[+-]\d{2}:\d{2}$/.test(taken) }).toISO();
  }
  return { kind, label, captured_at: SEGMENTED_KINDS.includes(kind) ? captured : null };
}

function meta(file: string, addedAt: string): SourceMeta {
  const m = metaOf(file);
  return { id: file, kind: m.kind, label: m.label, captured_at: m.captured_at, added_at: addedAt };
}

async function inputsOf(file: string): Promise<PageInput[]> {
  const path = join(FIX, file);
  const ext = extname(file).toLowerCase();
  if (ext === ".txt") return [{ page: null, image: null, text: readFileSync(path, "utf8") }];
  if (ext === ".pdf")
    return (await renderPdfPages(new Uint8Array(readFileSync(path)))).map((p) => ({
      page: p.page,
      image: new Uint8Array(p.png),
      mime: "image/png" as const,
      text: p.text,
    }));
  if (!real) {
    const bytes = new Uint8Array(readFileSync(path));
    return [{ page: null, image: bytes, mime: ext === ".png" ? "image/png" : "image/jpeg", text: null }];
  }
  // Real photos go through what the app does: upright, at most 2048px, plain JPEG. HEIC is converted by macOS.
  let src = path;
  if (ext === ".heic") {
    mkdirSync(join(REC, "converted"), { recursive: true });
    src = join(REC, "converted", `${basename(file, extname(file))}.jpg`);
    if (!existsSync(src)) execFileSync("sips", ["-s", "format", "jpeg", path, "--out", src], { stdio: "ignore" });
  }
  const p = await preparePhoto(new Uint8Array(readFileSync(src)));
  return [{ page: null, image: p.bytes, mime: p.mime, text: null }];
}

const emptyStage = (): Stage => ({ calls: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, cost_usd: 0 });
function add(stage: Stage, calls: CallResult[]) {
  for (const c of calls) {
    stage.calls++;
    stage.input_tokens += c.usage.input_tokens;
    stage.cached_tokens += c.usage.cached_tokens;
    stage.output_tokens += c.usage.output_tokens;
    stage.cost_usd += c.costUsd;
  }
}

let spent = 0;
async function record(file: string) {
  const env = readEnv();
  const opts = { log: () => {} };
  const kind = metaOf(file).kind;
  const stages = Object.fromEntries(STAGES.map((s) => [s, emptyStage()])) as Record<StageName, Stage>;
  const pages: RecPage[] = [];
  for (const p of await inputsOf(file)) {
    const ex = await extractPage(kind, p, opts);
    add(stages.extract, ex.calls);
    const page: RecPage = { page: p.page, text: p.text, extraction: ex.extraction, rereads: {}, sam: null };
    if (p.text === null && p.image) {
      const box = await rereadPage(p.image, ex.extraction, opts);
      add(stages.reread_box, box.calls);
      page.rereads = box.rereads;
      if (SEGMENTED_KINDS.includes(kind)) {
        const seg = await segmentPage(p.image, p.mime ?? "image/png", opts);
        add(stages.sam_segment, seg.calls);
        const r = await rereadPage(p.image, ex.extraction, opts, seg.objects);
        add(stages.reread_sam, r.calls);
        page.sam = { objects: seg.objects, rereads: r.rereads };
      }
    }
    pages.push(page);
  }
  const cost = STAGES.reduce((a, s) => a + stages[s].cost_usd, 0);
  spent += cost;
  const rec: Recording = {
    file,
    sha256: sha(readFileSync(join(FIX, file))),
    model: env.MUSE_SPARK_MODEL,
    sam_model: env.SAM_MODEL,
    tasks: TASK_VERSIONS,
    crops: CROP_VERSION,
    added_at: real ? DateTime.now().setZone(ZONE).toISO()! : "2026-10-29T09:00:00-04:00",
    pages,
    stages,
  };
  mkdirSync(REC, { recursive: true });
  writeFileSync(recPath(file), JSON.stringify(rec, null, 2) + "\n");
  console.log(`  recorded ${real ? "a real input" : file}: $${cost.toFixed(4)}`);
}

function loadRec(file: string): Recording {
  let rec: Recording;
  try {
    rec = JSON.parse(readFileSync(recPath(file), "utf8")) as Recording;
  } catch {
    throw new Error(`no recording for ${file}; run pnpm eval:${real ? "real" : "live"}`);
  }
  if (rec.sha256 !== sha(readFileSync(join(FIX, file))))
    throw new Error(`${file} changed since it was recorded; run pnpm eval:${real ? "real" : "live"}`);
  // Only the tasks this input is read with: bumping the syllabus task doesn't re-read whiteboards.
  const used = [taskFor(metaOf(file).kind).name, rereadTask(1).name];
  for (const [name, v] of Object.entries(TASK_VERSIONS))
    if (used.includes(name) && rec.tasks[name] !== undefined && rec.tasks[name] !== v)
      throw new Error(`${file} was recorded with ${name}@v${rec.tasks[name]}; run pnpm eval:${real ? "real" : "live"}`);
  if (SEGMENTED_KINDS.includes(metaOf(file).kind) && rec.crops !== CROP_VERSION)
    throw new Error(`${file} was recorded with crops v${rec.crops}; run pnpm eval:${real ? "real" : "live"}`);
  return rec;
}

type Mode = "sam" | "box";
function load(file: string, addedAt: string, mode: Mode): SourceReading {
  const rec = loadRec(file);
  const pages: PageReading[] = rec.pages.map(({ sam, ...p }) =>
    mode === "sam" && sam ? { ...p, rereads: sam.rereads, objects: sam.objects } : p,
  );
  return { source: meta(file, addedAt), pages };
}

// Scoring.
const titleMatches = (gold: Pick<GoldItem, "course" | "title" | "match">, item: PlanItem) => {
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
  thenDates: number;
  thenRight: number;
  photoQuotes: number;
  inRegion: number;
  notes: string[];
};

function scoreDates(gold: GoldItem[], plan: Plan, s: Score, after: boolean) {
  const left = [...plan.items];
  for (const g of gold) {
    const i = left.findIndex((item) => titleMatches(g, item));
    if (i < 0) {
      if (after) s.notes.push(`after answering, missing: ${g.title}`);
      else s.missed.push(g.title);
      continue;
    }
    const item = left.splice(i, 1)[0];
    if (!after) {
      s.found++;
      if (g.sources && item.evidence.length !== g.sources)
        s.notes.push(`${g.title}: ${item.evidence.length} sources, expected ${g.sources}`);
      if (g.conflict) {
        if (!item.conflict) s.notes.push(`${g.title}: expected a conflict`);
        continue;
      }
    }
    if (!g.date) continue;
    if (after) s.thenDates++;
    else s.dates++;
    const got = item.date?.value ?? null;
    const timeOk = !g.time || (item.time?.start === g.time && (item.time?.end ?? null) === g.end);
    const label = after ? `after answering, ${g.title}` : g.title;
    if (got === g.date && timeOk) {
      if (after) s.thenRight++;
      else s.datesRight++;
    } else if (got !== null && got !== g.date) s.wrong.push(`${label}: ${got}, expected ${g.date}`);
    else if (got !== null) s.wrong.push(`${label}: ${item.time?.start}-${item.time?.end}, expected ${g.time}-${g.end}`);
    else s.notes.push(`${label}: no date yet (${item.status}: ${item.checks.date.reason ?? item.checks.quote.reason})`);
  }
  if (!after) s.extra = left.map((i) => i.title);
}

function score(c: Case, plan: Plan, sources: SourceMeta[]): Score {
  const x = c.expect;
  const s: Score = {
    name: c.name, things: 0, verified: 0, status: {}, goldItems: x?.items.length ?? 0, found: 0, extra: [],
    missed: [], dates: 0, datesRight: 0, wrong: [], invented: [], datesAudited: 0,
    conflictsExpected: x?.conflicts.length ?? 0, conflictsCaught: 0, suggestedRight: 0, falseConflicts: [],
    classesRight: 0, classesExpected: x?.classes.length ?? 0, thenDates: 0, thenRight: 0, photoQuotes: 0,
    inRegion: 0, notes: [],
  }; // prettier-ignore

  for (const thing of [...plan.items, ...plan.classes]) {
    s.things++;
    s.status[thing.status] = (s.status[thing.status] ?? 0) + 1;
    if (thing.status === "verified") s.verified++;
  }
  const photos = new Set(sources.filter((m) => SEGMENTED_KINDS.includes(m.kind)).map((m) => m.id));
  for (const e of plan.items.flatMap((i) => i.evidence))
    if (photos.has(e.source_id)) {
      s.photoQuotes++;
      if (e.region) s.inRegion++;
    }

  const audit = auditPlan(plan, sources);
  s.datesAudited = audit.dates;
  s.invented = audit.invented.map((f) => `${f.about} ${f.field} ${f.value}: ${f.why}`);
  if (!x) return s;

  // Classes: course, meeting type, days, and times all have to match.
  const unmatchedClasses = [...plan.classes];
  for (const g of x.classes) {
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
  scoreDates(x.items, plan, s, false);

  // Conflicts: caught, with the same options, and the right answer pre-selected.
  for (const g of x.conflicts) {
    const item = plan.items.find((i) => i.conflict && i.course === g.course && titleMatches(g, i));
    const q = item && plan.questions.find((y) => y.about === item.id && y.type === "conflict");
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
    if (i.conflict && !x.conflicts.some((g) => titleMatches(g, i))) s.falseConflicts.push(i.title);
  for (const o of x.overlaps)
    if (!plan.questions.some((q) => q.type === "class_overlap" && q.prompt.startsWith(o)))
      s.notes.push(`overlap missed: ${o}`);
  for (const k of x.crossed_out)
    if (!plan.crossed_out.some((cand) => new RegExp(k, "i").test(cand.title)))
      s.notes.push(`crossed-out line not set aside: ${k}`);
  if ((plan.term_start.date?.value ?? null) !== x.term_start)
    s.notes.push(`term start ${plan.term_start.date?.value ?? "none"}, expected ${x.term_start ?? "none"}`);
  if (x.term_end !== undefined) {
    if ((plan.term_end.date?.value ?? null) !== x.term_end)
      s.notes.push(`term end ${plan.term_end.date?.value ?? "none"}, expected ${x.term_end ?? "none"}`);
    for (const k of plan.classes)
      if (x.term_end ? !k.rrule.includes("UNTIL") || !k.last_date || k.last_date.value > x.term_end : k.last_date)
        s.notes.push(`${k.course} ${k.meeting_type}: recurrence end ${k.last_date?.value ?? "none"}`);
    if (!x.term_end && plan.classes.length && !plan.questions.some((q) => q.id === "q_term_end"))
      s.notes.push("didn't ask for the last day of classes");
  }
  if (x.breaks !== undefined) {
    const got = plan.term_breaks.breaks.map((b) => `${b.start}/${b.end}`).join(" ");
    const want = x.breaks.map(([a, b]) => `${a}/${b}`).join(" ");
    if (got !== want) s.notes.push(`breaks ${got || "none"}, expected ${want || "none"}`);
    const asked = plan.questions.some((q) => q.id === "q_breaks");
    if (!x.breaks.length && plan.classes.length && !asked) s.notes.push("didn't ask about breaks");
    if (x.breaks.length && asked) s.notes.push("asked about breaks a source lists");
    for (const k of plan.classes)
      if (x.breaks.length && !k.skip_dates.length) s.notes.push(`${k.course} ${k.meeting_type}: no meetings skipped`);
  }

  // Answer the conflicts as the person would, then check that dependents moved.
  if (c.then) {
    let after = plan;
    for (const a of c.then.answer) {
      const item = after.items.find((i) => i.conflict && titleMatches({ course: null, title: a.conflict }, i));
      const q = item && after.questions.find((y) => y.about === item.id && y.type === "conflict");
      const opt = q?.options.find((o) => o.value === a.pick);
      if (!q || !opt) {
        s.notes.push(`couldn't answer the ${a.conflict} conflict with ${a.pick}`);
        continue;
      }
      after = answerQuestion(after, q.id, opt.id);
    }
    scoreDates(c.then.items, after, s, true);
    const again = auditPlan(after, sources);
    s.datesAudited += again.dates;
    s.invented.push(...again.invented.map((f) => `after answering, ${f.about} ${f.field} ${f.value}: ${f.why}`));
  }
  return s;
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");

function loadCases(): Case[] {
  if (existsSync(CASES) && readdirSync(CASES).some((f) => f.endsWith(".json")))
    return readdirSync(CASES)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(CASES, f), "utf8")) as Case)
      .filter((c) => !only || c.name === only);
  // Real photos without gold: each one alone, and all of them together. Only the headline numbers are scored.
  const files = realFiles();
  const base = { zone: ZONE, added_at: "", description: "" };
  return [
    ...files.map((f, i) => ({ ...base, name: `real-${i + 1}`, sources: [f] })),
    ...(files.length > 1 ? [{ ...base, name: "real-all", sources: files }] : []),
  ];
}

const cases = loadCases();
if (real && !realFiles().length) {
  console.log(`No photos in local-inputs/ yet. Add .jpg, .png, .heic, or .pdf files there and run pnpm eval:real.`);
  process.exit(0);
}
if (!cases.length) throw new Error(only ? `no case named ${only}` : "no eval cases");

const files = [...new Set(cases.flatMap((c) => c.sources))];
if (live || real) {
  // Never pay twice: only inputs whose recording is missing or stale are re-read, unless --force.
  const todo = force ? files : files.filter((f) => !fresh(f));
  if (todo.length) {
    console.log(`Recording ${todo.length} input(s) with ${readEnv().MUSE_SPARK_MODEL} and ${readEnv().SAM_MODEL}...`);
    for (const f of todo) await record(f);
  }
}
function fresh(file: string): boolean {
  try {
    loadRec(file);
    return true;
  } catch {
    return false;
  }
}

type Headline = Record<string, string | number>;
function runMode(mode: Mode): { scores: Score[]; headline: Headline } {
  const scores: Score[] = [];
  for (const c of cases) {
    const readings = c.sources.map((f) => load(f, c.added_at || loadRec(f).added_at, mode));
    const plan = buildPlan(readings, { zone: c.zone });
    const s = score(
      c,
      plan,
      readings.map((r) => r.source),
    );
    scores.push(s);
    if (mode !== "sam") continue;
    const bad = s.invented.length || s.notes.some((n) => n.startsWith("conflict"));
    console.log(
      `${bad ? "✗" : "✓"} ${c.name.padEnd(20)} verified ${String(s.verified).padStart(2)}/${String(s.things).padEnd(3)}` +
        (c.expect
          ? ` found ${s.found}/${s.goldItems}${s.classesExpected ? ` classes ${s.classesRight}/${s.classesExpected}` : ""} dates ${s.datesRight}/${s.dates}` +
            `${s.conflictsExpected ? ` conflicts ${s.conflictsCaught}/${s.conflictsExpected} (pre-selected right ${s.suggestedRight})` : ""}` +
            `${s.thenDates ? ` after answers ${s.thenRight}/${s.thenDates}` : ""}` +
            `${s.falseConflicts.length ? ` false conflicts: ${s.falseConflicts.join(", ")}` : ""}`
          : "") +
        ` invented ${s.invented.length}`,
    );
    // Real inputs are the person's own: nothing from them is printed unless asked.
    if ((verbose || (s.invented.length && !real)) && (!real || verbose)) {
      for (const line of [
        ...s.invented,
        ...s.wrong,
        ...s.missed.map((m) => `missed: ${m}`),
        ...s.extra.map((e) => `extra: ${e}`),
        ...s.notes,
      ])
        console.log(`    ${line}`);
      if (verbose)
        for (const q of plan.questions)
          console.log(
            `    ? [${q.type}] ${q.prompt}${q.suggested ? ` → pre-selected ${q.options.find((o) => o.id === q.suggested)?.label}` : ""}${q.why_suggested ? ` (${q.why_suggested})` : ""}`,
          );
    }
  }
  const sum = (k: keyof Score) => scores.reduce((a, s) => a + (s[k] as number), 0);
  const count = (k: keyof Score) => scores.reduce((a, s) => a + (s[k] as string[]).length, 0);
  const status: Record<string, number> = {};
  for (const s of scores) for (const [k, v] of Object.entries(s.status)) status[k] = (status[k] ?? 0) + v;
  return {
    scores,
    headline: {
      fully_verified: `${sum("verified")}/${sum("things")} (${pct(sum("verified"), sum("things"))})`,
      invented_dates: `${count("invented")} of ${sum("datesAudited")}`,
      items_found: `${sum("found")}/${sum("goldItems")}`,
      classes_right: `${sum("classesRight")}/${sum("classesExpected")}`,
      dates_right: `${sum("datesRight")}/${sum("dates")}`,
      dates_right_after_answers: `${sum("thenRight")}/${sum("thenDates")}`,
      wrong_dates: count("wrong"),
      conflicts_caught: `${sum("conflictsCaught")}/${sum("conflictsExpected")}`,
      conflict_answer_preselected_right: `${sum("suggestedRight")}/${sum("conflictsExpected")}`,
      false_conflicts: count("falseConflicts"),
      photo_quotes_in_an_object: `${sum("inRegion")}/${sum("photoQuotes")}`,
      status: Object.entries(status)
        .map(([k, v]) => `${k} ${v}`)
        .join(", "),
    },
  };
}

// Model cost per photo for each way of reading it, from the recordings: the first read is shared.
function costs() {
  const recs = files.map(loadRec);
  const photos = recs.filter((r) => SEGMENTED_KINDS.includes(metaOf(r.file).kind));
  const total = (r: Recording, stages: StageName[]) => stages.reduce((a, s) => a + (r.stages?.[s]?.cost_usd ?? 0), 0);
  const per = (stages: StageName[]) =>
    photos.length ? photos.reduce((a, r) => a + total(r, stages), 0) / photos.length : 0;
  const all = recs.flatMap((r) => STAGES.map((s) => r.stages?.[s] ?? emptyStage()));
  const calls = all.reduce((a, s) => a + s.calls, 0);
  const input = all.reduce((a, s) => a + s.input_tokens, 0);
  const cached = all.reduce((a, s) => a + s.cached_tokens, 0);
  const output = all.reduce((a, s) => a + s.output_tokens, 0);
  return {
    photos: photos.length,
    box_per_photo: per(["extract", "reread_box"]),
    sam_per_photo: per(["extract", "sam_segment", "reread_sam"]),
    tokens_per_call: calls ? `${Math.round(input / calls)} in, ${Math.round(output / calls)} out` : "n/a",
    cache_hit_rate: pct(cached, input),
  };
}

const sam = runMode("sam");
const box = runMode("box");
const cost = costs();
const rows: [string, string][] = [
  ["Fully verified", "fully_verified"],
  ["Invented dates", "invented_dates"],
  ["Items found", "items_found"],
  ["Classes right", "classes_right"],
  ["Dates right", "dates_right"],
  ["  after answers", "dates_right_after_answers"],
  ["Wrong dates", "wrong_dates"],
  ["Conflicts caught", "conflicts_caught"],
  ["  pre-selected right", "conflict_answer_preselected_right"],
  ["False conflicts", "false_conflicts"],
  ["Photo quotes in an object", "photo_quotes_in_an_object"],
];
const money = (v: number) => `$${v.toFixed(4)}`;
console.log(`\n${"".padEnd(27)}${"with SAM".padEnd(18)}without SAM`);
for (const [label, key] of rows)
  if (
    !real ||
    ["fully_verified", "invented_dates", "photo_quotes_in_an_object"].includes(key) ||
    cases.some((c) => c.expect)
  )
    console.log(`${label.padEnd(27)}${String(sam.headline[key]).padEnd(18)}${box.headline[key]}`);
console.log(
  `${"Model cost per photo".padEnd(27)}${money(cost.sam_per_photo).padEnd(18)}${money(cost.box_per_photo)}   (${cost.photos} photos)`,
);
console.log(`Status (with SAM): ${sam.headline.status}`);
console.log(`Tokens per call: ${cost.tokens_per_call}; prompt cache hit rate ${cost.cache_hit_rate}`);
if (spent) console.log(`Model spend this run: $${spent.toFixed(4)}`);

if (!only)
  writeFileSync(
    RESULTS,
    JSON.stringify(
      { headline: { cases: cases.length, with_sam: sam.headline, without_sam: box.headline, cost }, cases: sam.scores },
      null,
      2,
    ) + "\n",
  );

// The two promises the demo makes, and the two deliberate conflicts, fail the run if broken, in either mode.
for (const { scores } of [sam, box]) {
  const s = (k: keyof Score) => scores.reduce((a, x) => a + (x[k] as number), 0);
  const invented = scores.reduce((a, x) => a + x.invented.length, 0);
  if (invented > 0 || s("conflictsCaught") < s("conflictsExpected") || s("suggestedRight") < s("conflictsExpected"))
    process.exitCode = 1;
}
