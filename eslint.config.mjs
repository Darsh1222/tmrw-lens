import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Copied from pdfjs-dist by scripts/copy-pdfjs.mjs.
    "public/pdfjs/**",
    // A read-only snapshot of Tomorrow's hackathon code, shown as it is; it isn't built here.
    "tomorrow-integration/**",
  ]),
]);

export default eslintConfig;
