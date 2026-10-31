import { z } from "zod";
import { readEnv } from "@/lib/env";
import { CROP_VERSION, readPage, SEGMENTED_KINDS } from "@/lib/extract/read";
import { rereadTask, taskFor } from "@/lib/extract/tasks";
import { MetaApiError, MetaIncomplete } from "@/lib/meta/client";
import { SpendCapReached } from "@/lib/meta/spend";
import type { PageReading } from "@/lib/plan/types";
import { SourceKind } from "@/lib/schemas/evidence";
import { contentCache, kvFor, RateLimited, rateLimit } from "@/lib/server/kv";

// Reads one page or photo with Muse Spark (and SAM 3.1 on photos). The browser
// has already shrunk the photo (or rendered the PDF page) and sends one at a
// time, so every request is small and finishes well inside the time limit.
// Nothing sent here is stored: the reading is cached for 24 hours, encrypted
// with a key only the same image can produce (src/lib/server/kv.ts).

export const maxDuration = 120;

const MAX_IMAGE_BYTES = 4_000_000;
const MAX_TEXT = 40_000;

const Meta = z.object({
  kind: SourceKind,
  page: z.int().positive().nullable(),
});

type Reply = { page: PageReading; cached: boolean; cost_usd: number; calls: number };

const fail = (status: number, error: string, extra: Record<string, string> = {}) =>
  Response.json({ error }, { status, headers: extra });

function imageMime(b: Uint8Array): "image/jpeg" | "image/png" | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Send the page as a form.");
  }
  const meta = Meta.safeParse(JSON.parse(String(form.get("meta") ?? "null")));
  if (!meta.success) return fail(400, "Missing or unknown kind of input.");
  const { kind, page } = meta.data;
  const file = form.get("image");
  const text = typeof form.get("text") === "string" ? (form.get("text") as string).slice(0, MAX_TEXT) || null : null;

  let image: Uint8Array | null = null;
  if (file instanceof File) {
    if (file.size > MAX_IMAGE_BYTES) return fail(413, "That image is too large; it should have been shrunk first.");
    image = new Uint8Array(await file.arrayBuffer());
  }
  const mime = image ? imageMime(image) : null;
  if (image && !mime) return fail(415, "Only JPEG and PNG images can be read.");
  if (!image && !text) return fail(400, "Nothing to read.");
  if (kind === "testudo_text" ? !text : !image) return fail(400, "That kind of input needs an image.");

  const env = readEnv();
  const kv = kvFor(env);
  const salt = [kind, taskFor(kind).version, rereadTask(1).version, CROP_VERSION, env.MUSE_SPARK_MODEL, env.SAM_MODEL, page ?? 0].join("|"); // prettier-ignore
  const content = image ? Buffer.concat([image, Buffer.from(`\n${text ?? ""}`)]) : (text ?? "");
  const cache = contentCache(kv, salt);
  const hit = await cache.get<PageReading>(content).catch(() => null);
  if (hit) return Response.json({ page: hit, cached: true, cost_usd: 0, calls: 0 } satisfies Reply);

  try {
    const visitor =
      request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
    await rateLimit(kv, visitor.trim(), { perHour: env.READS_PER_HOUR, perDay: env.READS_PER_DAY });
    const { page: reading, calls } = await readPage(
      kind,
      { page, image, mime: mime ?? undefined, text: kind === "testudo_text" ? text : image ? text : null },
      { env, sam: SEGMENTED_KINDS.includes(kind) },
    );
    await cache.set(content, reading).catch(() => {});
    const cost = calls.reduce((a, c) => a + c.costUsd, 0);
    return Response.json({ page: reading, cached: false, cost_usd: cost, calls: calls.length } satisfies Reply);
  } catch (e) {
    if (e instanceof RateLimited)
      return fail(429, "You've read a lot of pages in a short time. Try again a bit later, or use the sample week.", {
        "Retry-After": String(e.retryAfterSeconds),
      });
    if (e instanceof SpendCapReached)
      return fail(503, "Lens has reached today's spending limit for model calls. The sample week still works.");
    if (e instanceof MetaApiError || e instanceof MetaIncomplete)
      return fail(502, "The model didn't answer properly. Try this page again.");
    // No content in logs: only what failed.
    console.error("read failed:", e instanceof Error ? e.name : "unknown");
    return fail(500, "Something went wrong reading this page.");
  }
}
