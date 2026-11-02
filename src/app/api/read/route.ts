import { z } from "zod";
import { readEnv } from "@/lib/env";
import { MetaApiError, MetaIncomplete } from "@/lib/meta/client";
import { admitFor, chargeTo, LimitReached } from "@/lib/meta/spend";
import type { PageReading } from "@/lib/plan/types";
import { SourceKind } from "@/lib/schemas/evidence";
import { visitorPayer } from "@/lib/server/identity";
import { kvFor } from "@/lib/server/kv";
import { readCached } from "@/lib/server/read";

// Reads one page or photo with Muse Spark (and SAM 3.1 on photos). The browser
// has already shrunk the photo (or rendered the PDF page) and sends one at a
// time, so every request is small and finishes well inside the time limit.
// Nothing sent here is stored: the reading is cached for 24 hours, encrypted
// with a key only the same image can produce (src/lib/server/kv.ts). Each page
// the model reads is charged to the visitor (a signed cookie and their address)
// against their daily limit; a cached page is free (src/lib/server/identity.ts).

export const maxDuration = 120;

const MAX_IMAGE_BYTES = 4_000_000;
const MAX_TEXT = 40_000;

const Meta = z.object({
  kind: SourceKind,
  page: z.int().positive().nullable(),
});

type Reply = { page: PageReading; cached: boolean; cost_usd: number; calls: number };

const fail = (status: number, error: string, headers: Record<string, string> = {}, code?: string) =>
  Response.json(code ? { error, code } : { error }, { status, headers });

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
  const { payer, setCookie } = visitorPayer(env, request);
  const headers: Record<string, string> = setCookie ? { "Set-Cookie": setCookie } : {};
  try {
    // Counted only when the model is called: a cached page is free for everyone.
    const {
      page: reading,
      cached,
      calls,
    } = await chargeTo(payer, () =>
      readCached({ kind, page, image, mime: mime ?? undefined, text }, { env, kv, onMiss: () => admitFor(env, payer) }),
    );
    const cost = calls.reduce((a, c) => a + c.costUsd, 0);
    return Response.json({ page: reading, cached, cost_usd: cost, calls: calls.length } satisfies Reply, { headers });
  } catch (e) {
    if (e instanceof LimitReached)
      return fail(
        e.code === "user_limit" ? 429 : 503,
        e.code === "user_limit"
          ? "That's all the free reading for today. Come back tomorrow; the sample week is always free."
          : "Lens has read all it can for visitors today. Come back tomorrow; the sample week is always free.",
        { ...headers, "Retry-After": String(e.retryAfterSeconds) },
        e.code,
      );
    if (e instanceof MetaApiError || e instanceof MetaIncomplete)
      return fail(502, "The model didn't answer properly. Try this page again.", headers);
    // No content in logs: only what failed.
    console.error("read failed:", e instanceof Error ? e.name : "unknown");
    return fail(500, "Something went wrong reading this page.", headers);
  }
}
