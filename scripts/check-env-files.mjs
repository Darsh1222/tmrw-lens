// Fails if git tracks (or has staged) any .env* file other than .env.example.
// Runs in the pre-commit hook and in CI. Usage: pnpm check:env
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z", "--cached"], { encoding: "utf8" }).split("\0").filter(Boolean);
const bad = tracked.filter((path) => {
  const name = basename(path);
  return name.startsWith(".env") && name !== ".env.example";
});

if (bad.length > 0) {
  console.error("These env files are tracked by git and must not be:");
  for (const path of bad) console.error(`  ${path}`);
  console.error("Remove them from the index with: git rm --cached <path>");
  process.exit(1);
}
console.log(`check:env ok (${tracked.length} tracked files, no .env files besides .env.example)`);
