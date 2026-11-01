import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { REBUILD_VERSION, rebuild } from "@/lib/rebuild/agent";
import { RebuildRequest, RebuildResponse } from "@/lib/rebuild/contract";
import { checkResponse, fallback } from "@/lib/rebuild/draft";
import { contentCache, kvFor } from "@/lib/server/kv";

// Tomorrow calls this when a planned session passes undone and the check-in
// came back "skipped" (or got no reply). Lens decides what moves or drops, and
// returns the diff and the one recovery message (docs/REBUILD_CONTRACT.md).
// Only Tomorrow can call it: a shared secret, compared in constant time. The
// same request twice is answered from the encrypted 24-hour cache, so a retry
// never pays twice. Logs hold counts and costs, never the plan.

export const maxDuration = 60;

const MAX_BODY = 200_000;

const fail = (status: number, error: string, issues?: string) =>
  Response.json(issues ? { error, issues } : { error }, { status });

const digest = (s: string) => createHash("sha256").update(s).digest();

function authorized(header: string | null, secret: string): boolean {
  const token = header?.match(/^Bearer (.+)$/)?.[1];
  return !!token && timingSafeEqual(digest(token), digest(secret));
}

export async function POST(request: Request): Promise<Response> {
  const env = readEnv();
  if (!env.LENS_REBUILD_SECRET) return fail(503, "Rebuild isn't set up on this deployment.");
  if (!authorized(request.headers.get("authorization"), env.LENS_REBUILD_SECRET)) return fail(401, "Unauthorized.");

  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail(413, "That plan is too large.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail(400, "The body isn't JSON.");
  }
  const parsed = RebuildRequest.safeParse(json);
  if (!parsed.success) return fail(422, "The request doesn't match the rebuild contract.", z.prettifyError(parsed.error)); // prettier-ignore
  const req = parsed.data;

  const cache = contentCache(kvFor(env), `rebuild|${REBUILD_VERSION}|${env.MUSE_SPARK_MODEL}`);
  const hit = await cache.get<RebuildResponse>(raw).catch(() => null);
  if (hit) return Response.json(hit);

  const run = await rebuild(req, { env, budgetMs: 45_000 });
  let response = run.response;
  // The agent's diff was checked before it was returned; this guards the fallback too, and any future path.
  if (checkResponse(req, response).length) response = fallback(req).response("fallback");
  RebuildResponse.parse(response);
  // A fallback after a passing error isn't cached: Tomorrow's retry gets another try with the model.
  if (response.decided_by === "agent") await cache.set(raw, response).catch(() => {});
  console.info(
    JSON.stringify({
      event: "rebuild",
      decided_by: response.decided_by,
      fell_back: run.fellBack,
      turns: run.turns,
      refused: run.refused,
      changes: response.diff.filter((x) => x.action !== "keep").length,
      cost_usd: Number(run.calls.reduce((a, c) => a + c.costUsd, 0).toFixed(6)),
    }),
  );
  return Response.json(response);
}
