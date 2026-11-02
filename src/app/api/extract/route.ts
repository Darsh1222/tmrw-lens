import { z } from "zod";
import { readEnv } from "@/lib/env";
import { MetaApiError, MetaIncomplete } from "@/lib/meta/client";
import { admitFor, chargeTo, LimitReached } from "@/lib/meta/spend";
import { TaskFailed } from "@/lib/meta/task";
import { fromTomorrow } from "@/lib/server/auth";
import { tomorrowPayer } from "@/lib/server/identity";
import { kvFor } from "@/lib/server/kv";
import { imageType, readPhotos } from "@/lib/server/photos";
import { reviewStore } from "@/lib/server/review";
import { assemble, ExtractRequest, ExtractResponse, MAX_IMAGE_BYTES, type ExtractState } from "@/lib/tomorrow/extract";

// Text-a-photo: Tomorrow sends the photos someone texted, with their existing
// items; Lens returns what's new, what changed, what it needs to ask, and a
// review link (docs/EXTRACT_CONTRACT.md). Server to server, with the shared
// secret. Each photo the model reads is charged to the person (`user_ref`,
// hashed): 30 a day and $0.50, shared with their rebuilds, under Tomorrow's
// global brake (without a `user_ref`, the shared "tomorrow-unknown" identity);
// a cached photo is free (src/lib/server/identity.ts). The
// photos exist only in memory for this request; what was read is cached
// encrypted for 24 hours.

export const maxDuration = 120;

const fail = (status: number, error: string, extra?: Record<string, string>, headers?: Record<string, string>) =>
  Response.json({ error, ...extra }, { status, headers });

export async function POST(request: Request): Promise<Response> {
  const env = readEnv();
  if (!env.LENS_REBUILD_SECRET) return fail(503, "Extract isn't set up on this deployment.");
  if (!fromTomorrow(request.headers.get("authorization"), env.LENS_REBUILD_SECRET)) return fail(401, "Unauthorized.");
  const parsed = ExtractRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return fail(422, "The request doesn't match the extract contract.", { issues: z.prettifyError(parsed.error) });
  const req = parsed.data;

  const images: Uint8Array[] = [];
  for (const [n, img] of req.images.entries()) {
    const bytes = new Uint8Array(Buffer.from(img.data, "base64"));
    if (bytes.length > MAX_IMAGE_BYTES) return fail(413, `Image ${n} is over 3 MB; shrink it to 2048 px first.`);
    const type = imageType(bytes);
    if (type === "heic") return fail(415, `Image ${n} is HEIC; convert it to JPEG first.`);
    if (!type) return fail(415, `Image ${n} isn't a JPEG or PNG.`);
    images.push(bytes);
  }

  const kv = kvFor(env);
  const payer = tomorrowPayer(env, req.user_ref);
  try {
    const read = await chargeTo(payer, () =>
      readPhotos(images, { env, kv, now: req.now, onMiss: () => admitFor(env, payer) }),
    );
    const state: ExtractState = {
      version: 1,
      zone: req.zone,
      now: req.now,
      readings: read.readings,
      photos: read.photos,
      existing: req.existing,
      term: req.term,
      answers: [],
    };
    const link = await reviewStore(kv, env.LENS_REBUILD_SECRET).create(state);
    const response = ExtractResponse.parse(
      assemble(state, { url: `${env.LENS_PUBLIC_URL}/review/${link.token}`, expires_at: link.expires_at }),
    );
    console.info(
      JSON.stringify({
        event: "extract",
        photos: images.length,
        calls: read.calls.length,
        cost_usd: Number(read.calls.reduce((a, c) => a + c.costUsd, 0).toFixed(6)),
        items: response.items.length,
        auto_apply: response.items.filter((i) => i.auto_apply).length,
        changes: response.changes.length,
        questions: response.questions.length,
      }),
    );
    return Response.json(response);
  } catch (e) {
    if (e instanceof LimitReached)
      return fail(
        e.code === "user_limit" ? 429 : 503,
        e.code === "user_limit" ? "This person's photo reads are used up for today." : "Lens's budget for Tomorrow is used up for today.", // prettier-ignore
        { code: e.code },
        { "Retry-After": String(e.retryAfterSeconds) },
      );
    if (e instanceof MetaApiError || e instanceof MetaIncomplete || e instanceof TaskFailed)
      return fail(502, "The model didn't answer properly. Try again.");
    // No content in logs: only what failed.
    console.error("extract failed:", e instanceof Error ? e.name : "unknown");
    return fail(500, "Something went wrong reading the photos.");
  }
}
