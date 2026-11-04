// Speed benchmark: how long a person waits, per kind of input, on a fixed set
// of synthetic files, with live model calls and no cache. "First" is when the
// first page's items are back (what the plan can show); "full" is when every
// page is read and checked. p50/p90 per input type, written to
// evals/bench.json. Costs money (about $0.25 a pass); run it on purpose:
//
//   pnpm bench                 the pipeline as the app runs it now
//   pnpm bench -- --runs 3     more samples
//
// `--strategy before` replays the old pipeline (every PDF page read as an image, three requests at a time, SAM and the
// re-read before anything shows), so the before/after table can be rebuilt.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readEnv } from "@/lib/env";
import { extractPage, readPage } from "@/lib/extract/read";
import { contentCache, kvFor } from "@/lib/server/kv";
import type { SourceKind } from "@/lib/schemas/evidence";
import { renderPdfPages } from "./lib/render-pdf";
import { usableText } from "@/lib/files/convert";

const args = process.argv.slice(2);
const flag = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const RUNS = Number(flag("--runs") ?? 2);
const strategy = (flag("--strategy") ?? "after") as "before" | "after";
const only = flag("--only"); // a type, e.g. "screenshot": just those cases
const FIX = join(process.cwd(), "fixtures", "synthetic");
const OUT = join(process.cwd(), "evals", "bench.json");

type Page = { page: number | null; image: Uint8Array | null; mime?: "image/png" | "image/jpeg"; text: string | null };
type Case = { type: string; name: string; kind: SourceKind; pages: Page[] };

async function pdf(file: string, { scanned = false, times = 1 } = {}): Promise<Page[]> {
  const pages = await renderPdfPages(new Uint8Array(readFileSync(join(FIX, file))));
  const one = pages.map((p) => ({ page: p.page, image: new Uint8Array(p.png), mime: "image/png" as const, text: scanned ? null : p.text })); // prettier-ignore
  return Array.from({ length: times }, () => one)
    .flat()
    .map((p, i) => ({ ...p, page: i + 1 }));
}
const image = (file: string): Page[] => [
  { page: null, image: new Uint8Array(readFileSync(join(FIX, file))), mime: file.endsWith(".png") ? "image/png" : "image/jpeg", text: null }, // prettier-ignore
];

async function cases(): Promise<Case[]> {
  const scanned = [...(await pdf("syllabus-math141.pdf", { scanned: true })), ...(await pdf("syllabus-phys161-policies.pdf", { scanned: true })), ...(await pdf("syllabus-cmsc131.pdf", { scanned: true }))]; // prettier-ignore
  const tenPages = Array.from({ length: 10 }, (_, i) => ({ ...scanned[i % scanned.length], page: i + 1 }));
  return [
    { type: "text PDF", name: "syllabus-math141", kind: "syllabus_pdf", pages: await pdf("syllabus-math141.pdf") },
    { type: "text PDF", name: "syllabus-phys161", kind: "syllabus_pdf", pages: await pdf("syllabus-phys161-policies.pdf") }, // prettier-ignore
    { type: "text PDF", name: "syllabus-cmsc131", kind: "syllabus_pdf", pages: await pdf("syllabus-cmsc131.pdf") },
    { type: "photo", name: "whiteboard", kind: "whiteboard_photo", pages: image("whiteboard-math141.jpg") },
    { type: "photo", name: "sticky notes", kind: "notes_photo", pages: image("sticky-notes.jpg") },
    { type: "screenshot", name: "Testudo grid", kind: "testudo_screenshot", pages: image("testudo-grid.png") },
    { type: "scanned PDF, 10 pages", name: "scanned 10p", kind: "syllabus_pdf", pages: tenPages },
  ];
}

const env = readEnv();
const ms = (t0: number) => Math.round(performance.now() - t0);

/** Pages through a pool of `width` at a time; returns when the first page and the last page were done. */
async function pool(pages: Page[], width: number, one: (p: Page) => Promise<{ first: number }>, t0: number) {
  let first = Infinity;
  let next = 0;
  let cost = 0;
  const worker = async () => {
    while (next < pages.length) {
      const p = pages[next++];
      const r = await one(p);
      first = Math.min(first, r.first);
      cost += 0;
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, pages.length) }, worker));
  return { first, full: ms(t0), cost };
}

let spend = 0;
async function timeOne(c: Case): Promise<{ first: number; full: number }> {
  const t0 = performance.now();
  if (strategy === "before")
    return pool(
      c.pages,
      3,
      async (p) => {
        const r = await readPage(c.kind, p, { env });
        spend += r.calls.reduce((a, x) => a + x.costUsd, 0);
        return { first: ms(t0) };
      },
      t0,
    );
  // After: text pages go as text; everything at once; the items show as soon as each page's first read is back,
  // and the checking (SAM and the re-read) finishes behind them.
  return pool(
    c.pages,
    8,
    async (p) => {
      const textual = usableText(p.text) && c.kind !== "testudo_screenshot";
      const input = textual ? { ...p, image: null } : p;
      if (textual) {
        const r = await extractPage(c.kind, input, { env });
        spend += r.calls.reduce((a, x) => a + x.costUsd, 0);
        return { first: ms(t0) };
      }
      let first = 0;
      const r = await readPage(c.kind, input, { env, onExtracted: () => (first = ms(t0)) });
      spend += r.calls.reduce((a, x) => a + x.costUsd, 0);
      return { first: first || ms(t0) };
    },
    t0,
  );
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function main() {
  const all = (await cases()).filter((c) => !only || c.type === only);
  const samples: Record<string, { first: number[]; full: number[] }> = {};
  const failures: Record<string, string[]> = {};
  for (let r = 0; r < RUNS; r++)
    for (const c of all) {
      const t0 = performance.now();
      const t = await timeOne(c).catch((e: unknown) => {
        // A failed read counts as what the person saw: the time until the error, marked.
        console.log(`${strategy} run ${r + 1} ${c.name.padEnd(18)} FAILED after ${ms(t0)} ms: ${e instanceof Error ? e.name : "error"}`); // prettier-ignore
        (failures[c.type] ??= []).push(c.name);
        return { first: ms(t0), full: ms(t0) };
      });
      (samples[c.type] ??= { first: [], full: [] }).first.push(t.first);
      samples[c.type].full.push(t.full);
      console.log(`${strategy} run ${r + 1} ${c.name.padEnd(18)} first ${t.first} ms, full ${t.full} ms  ($${spend.toFixed(3)} so far)`); // prettier-ignore
    }
  // A cached repeat: the content cache's round trip (what any second read of the same bytes costs).
  const kv = kvFor(env);
  const cache = contentCache(kv, "bench");
  await cache.set("bench-page", { ok: true });
  const hits: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await cache.get("bench-page");
    hits.push(ms(t0));
  }
  samples["cached repeat"] = { first: hits, full: hits };
  const table = Object.fromEntries(
    Object.entries(samples).map(([k, v]) => [k, { first_p50: pct(v.first, 50), first_p90: pct(v.first, 90), full_p50: pct(v.full, 50), full_p90: pct(v.full, 90), n: v.full.length }]), // prettier-ignore
  );
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  if (only) {
    // Just one type: merged into the strategy's table, the other types kept.
    const was = prev[strategy] ?? { table: {} };
    writeFileSync(OUT, JSON.stringify({ ...prev, [strategy]: { ...was, table: { ...was.table, [only]: table[only] }, spend_usd: Number(((was.spend_usd ?? 0) + spend).toFixed(4)) } }, null, 2) + "\n"); // prettier-ignore
    console.table(table);
    console.log(`Model spend this run: $${spend.toFixed(4)}`);
    return;
  }
  writeFileSync(OUT, JSON.stringify({ ...prev, [strategy]: { date: new Date().toISOString().slice(0, 10), runs: RUNS, model: env.MUSE_SPARK_MODEL, table, failures, spend_usd: Number(spend.toFixed(4)) } }, null, 2) + "\n"); // prettier-ignore
  console.table(table);
  console.log(`Model spend this run: $${spend.toFixed(4)}`);
}

void main();
