import { z } from "zod";
import { readEnv } from "@/lib/env";
import { REBUILD_VERSION, rebuild } from "@/lib/rebuild/agent";
import { RebuildRequest, RebuildResponse } from "@/lib/rebuild/contract";
import { checkResponse, fallback } from "@/lib/rebuild/draft";
import { admitFor, chargeTo, LimitReached } from "@/lib/meta/spend";
import { fromTomorrow } from "@/lib/server/auth";
import { tomorrowPayer } from "@/lib/server/identity";
import { contentCache, kvFor } from "@/lib/server/kv";

// Tomorrow calls this when a planned session passes undone and the check-in
// came back "skipped" (or got no reply). Lens decides what moves or drops, and
// returns the diff and the one recovery message (docs/REBUILD_CONTRACT.md).
// Only Tomorrow can call it: a shared secret, compared in constant time. The
// same request twice is answered from the encrypted 24-hour cache, so a retry
// never pays twice. Each run that reaches the model is charged to the person
// (`user_ref`, hashed): 30 a day and $0.50, under Tomorrow's global brake;
// without a `user_ref`, to the shared "tomorrow-unknown" identity. Past
// either, the answer is an error with a code (user_limit, global_limit) and
// Tomorrow uses its own code-only rebuild. Logs hold counts and costs, never the plan.

export const maxDuration = 60;

const MAX_BODY = 200_000;

const fail = (status: number, error: string, extra?: Record<string, string>, headers?: Record<string, string>) =>
  Response.json({ error, ...extra }, { status, headers });

export async function POST(request: Request): Promise<Response> {
  const env = readEnv();
  if (!env.LENS_REBUILD_SECRET) return fail(503, "Rebuild isn't set up on this deployment.");
  if (!fromTomorrow(request.headers.get("authorization"), env.LENS_REBUILD_SECRET)) return fail(401, "Unauthorized.");

  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail(413, "That plan is too large.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail(400, "The body isn't JSON.");
  }
  const parsed = RebuildRequest.safeParse(json);
  if (!parsed.success) return fail(422, "The request doesn't match the rebuild contract.", { issues: z.prettifyError(parsed.error) }); // prettier-ignore
  const req = parsed.data;
  const payer = tomorrowPayer(env, req.user_ref);

  const cache = contentCache(kvFor(env), `rebuild|${REBUILD_VERSION}|${env.MUSE_SPARK_MODEL}`);
  const hit = await cache.get<RebuildResponse>(raw).catch(() => null);
  if (hit) return Response.json(hit);

  let run: Awaited<ReturnType<typeof rebuild>>;
  try {
    await admitFor(env, payer);
    run = await chargeTo(payer, () => rebuild(req, { env, budgetMs: 45_000 }));
  } catch (e) {
    if (e instanceof LimitReached)
      return fail(
        e.code === "user_limit" ? 429 : 503,
        e.code === "user_limit" ? "This person's rebuilds are used up for today." : "Lens's budget for Tomorrow is used up for today.", // prettier-ignore
        { code: e.code },
        { "Retry-After": String(e.retryAfterSeconds) },
      );
    throw e;
  }
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
