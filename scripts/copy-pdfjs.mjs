// Copies pdf.js's worker and standard fonts into public/pdfjs/ so the browser can
// render syllabus pages itself. Generated on every dev and build; not in git.
import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const out = join(import.meta.dirname, "..", "public", "pdfjs");
mkdirSync(out, { recursive: true });
cpSync(join(root, "build", "pdf.worker.min.mjs"), join(out, "pdf.worker.min.mjs"));
cpSync(join(root, "standard_fonts"), join(out, "standard_fonts"), { recursive: true });
