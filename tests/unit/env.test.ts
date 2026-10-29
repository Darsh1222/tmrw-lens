import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_NAMES, readEnv } from "@/lib/env";

const example = readFileSync(new URL("../../.env.example", import.meta.url), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

describe(".env.example", () => {
  it("lists every variable Lens reads, and nothing else", () => {
    const names = example.map((l) => l.split("=")[0]).sort();
    expect(names).toEqual(ENV_NAMES.filter((n) => n !== "VERCEL_ENV").sort());
  });

  it("has no values", () => {
    for (const line of example) expect(line).toMatch(/^[A-Z0-9_]+=$/);
  });
});

describe("check-env-files", () => {
  const script = new URL("../../scripts/check-env-files.mjs", import.meta.url).pathname;
  const repoWith = (files: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "lens-env-"));
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir });
    git("init", "-q");
    for (const f of files) writeFileSync(join(dir, f), "X=1\n");
    git("add", "-f", ...files);
    return spawnSync("node", [script], { cwd: dir, encoding: "utf8" });
  };

  it("passes with only .env.example tracked", () => {
    expect(repoWith([".env.example", "a.ts"]).status).toBe(0);
  });

  it("fails when another .env file is staged", () => {
    const run = repoWith([".env.example", ".env.local"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(".env.local");
  });
});

describe("readEnv", () => {
  it("applies defaults and treats blanks as unset", () => {
    const env = readEnv({ META_API_KEY: "", DAILY_SPEND_CAP_USD: "2.5" });
    expect(env.META_API_KEY).toBeUndefined();
    expect(env.MUSE_SPARK_MODEL).toBe("muse-spark-1.3");
    expect(env.DAILY_SPEND_CAP_USD).toBe(2.5);
  });
});
