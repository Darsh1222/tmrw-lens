import { z } from "zod";

// Every variable Lens reads. Names (no values) are mirrored in .env.example;
// tests/unit/env.test.ts fails if the two drift apart.
const schema = z.object({
  META_API_KEY: z.string().min(1).optional(),
  META_API_BASE_URL: z.url().default("https://api.meta.ai/v1"),
  // Standard mode only: Contributor mode lets Meta train on what we send,
  // and visitors upload their own schedules (docs/DECISIONS.md).
  MUSE_SPARK_MODEL: z.string().default("muse-spark-1.3"),
  SAM_MODEL: z.string().default("sam-3.1"),
  // Global brakes per UTC day, in USD, behind the per-identity limits (src/lib/server/identity.ts):
  // the public demo's, and Tomorrow's users'. Demo traffic can't use up Tomorrow's budget.
  PUBLIC_DAILY_CAP_USD: z.coerce.number().positive().optional(),
  TOMORROW_DAILY_CAP_USD: z.coerce.number().positive().default(20),
  // The older name for PUBLIC_DAILY_CAP_USD, read only when that isn't set.
  DAILY_SPEND_CAP_USD: z.coerce.number().positive().optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  // Where Send delivers confirmed items (Tomorrow's side of docs/IMPORT_CONTRACT.md).
  TOMORROW_IMPORT_URL: z.url().default("https://bettertmrw.app/api/lens/import"),
  // Shared with Tomorrow, which sends it as a Bearer token on POST /api/rebuild and
  // /api/extract (docs/REBUILD_CONTRACT.md, docs/EXTRACT_CONTRACT.md); it also signs
  // review links. Unset: those routes answer 503. At least 32 characters.
  LENS_REBUILD_SECRET: z.string().min(32).optional(),
  // The owner's key: visiting /owner?key=<it> sets a signed cookie that skips the per-visitor and per-address limits
  // (the public brake still counts). Unset: there's no owner. At least 24 characters.
  OWNER_KEY: z.string().min(24).optional(),
  // Where review links point (text-a-photo, docs/EXTRACT_CONTRACT.md).
  LENS_PUBLIC_URL: z.url().default("https://tmrw-lens.vercel.app"),
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
});

export type Env = z.infer<typeof schema>;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  // Treat empty strings as unset so a blank line in .env.local doesn't fail validation.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  return schema.parse(cleaned);
}

export const ENV_NAMES = Object.keys(schema.shape) as (keyof Env)[];
