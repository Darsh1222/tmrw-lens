// Writes the app's built-in sample week from the eval recordings: the inputs of
// the full-week case (copied to public/samples/) and Muse Spark + SAM's recorded
// readings of them (src/lib/demo/sample-week.json). The sample costs nothing
// to try and reads the same as `pnpm eval` scores. Run after `pnpm eval:live`.
// Also the "Try a missed session" panel's recorded rebuilds, from
// evals/rebuild/recorded/ (src/lib/demo/rebuilds.json). Run after `pnpm eval:rebuild:live`.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PageReading, SourceReading } from "@/lib/plan/types";
import type { Step } from "@/lib/rebuild/agent";
import type { RebuildResponse } from "@/lib/rebuild/contract";
import type { SourceKind } from "@/lib/schemas/evidence";
import { REBUILD_CASES } from "../evals/rebuild/cases";

const ROOT = join(import.meta.dirname, "..");
const CASE = "full-week";

type Rec = { pages: (Omit<PageReading, "objects"> & { sam: { objects: PageReading["objects"]; rereads: PageReading["rereads"] } | null })[] }; // prettier-ignore
type Meta = { kind: SourceKind; label: string; captured_at: string | null };

const c = JSON.parse(readFileSync(join(ROOT, "evals", "cases", `${CASE}.json`), "utf8")) as {
  zone: string;
  added_at: string;
  sources: string[];
};
const manifest = JSON.parse(readFileSync(join(ROOT, "fixtures", "synthetic", "manifest.json"), "utf8")) as Record<string, Meta>; // prettier-ignore
mkdirSync(join(ROOT, "public", "samples"), { recursive: true });
mkdirSync(join(ROOT, "src", "lib", "demo"), { recursive: true });

const readings: SourceReading[] = c.sources.map((file) => {
  const rec = JSON.parse(readFileSync(join(ROOT, "evals", "recorded", `${file}.json`), "utf8")) as Rec;
  copyFileSync(join(ROOT, "fixtures", "synthetic", file), join(ROOT, "public", "samples", file));
  const m = manifest[file];
  return {
    source: { id: file, kind: m.kind, label: m.label, captured_at: m.captured_at, added_at: c.added_at },
    pages: rec.pages.map(({ sam, ...p }) => (sam ? { ...p, rereads: sam.rereads, objects: sam.objects } : p)),
  };
});

writeFileSync(
  join(ROOT, "src", "lib", "demo", "sample-week.json"),
  JSON.stringify({ zone: c.zone, files: c.sources.map((f) => `/samples/${f}`), readings }) + "\n",
);
console.log(`Sample week: ${c.sources.length} inputs from ${CASE}`);

// The panel's order: the everyday cases first, then the ones that show judgment.
const ORDER = ["tired-tonight", "busy-until", "make-room", "sick-today", "partial", "shorten", "no-time", "injection", "dst-weekend", "simple-move", "no-deadline"]; // prettier-ignore
type RebuildRec = {
  response: RebuildResponse;
  steps: Step[];
  turns: number;
  calls: { costUsd: number; latencyMs: number }[];
  judge: { score: number } | null;
};
const rebuilds = ORDER.map((name) => {
  const c = REBUILD_CASES.find((x) => x.name === name)!;
  const rec = JSON.parse(readFileSync(join(ROOT, "evals", "rebuild", "recorded", `${name}.json`), "utf8")) as RebuildRec; // prettier-ignore
  return {
    name,
    label: c.label,
    about: c.about,
    request: c.request,
    response: rec.response,
    steps: rec.steps,
    turns: rec.turns,
    cost_usd: rec.calls.reduce((a, x) => a + x.costUsd, 0),
    latency_s: rec.calls.reduce((a, x) => a + x.latencyMs, 0) / 1000,
    judge: rec.judge?.score ?? null,
  };
});
writeFileSync(join(ROOT, "src", "lib", "demo", "rebuilds.json"), JSON.stringify(rebuilds) + "\n");
console.log(`Rebuilds: ${rebuilds.length} recorded cases`);
