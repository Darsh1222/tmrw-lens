import { z } from "zod";
import REBUILDS from "@/lib/demo/rebuilds.json";
import { readEnv } from "@/lib/env";
import { REBUILD_VERSION, rebuild } from "@/lib/rebuild/agent";
import { RebuildRequest, RebuildResponse } from "@/lib/rebuild/contract";
import { checkResponse, fallback } from "@/lib/rebuild/draft";
import { contentCache, kvFor, RateLimited, rateLimit } from "@/lib/server/kv";

// "Try a missed session", live: one of the made-up demo weeks, with the reply
// the visitor types, rebuilt by the agent right now. Only the reply comes from
// the visitor; the plan is the recorded case's. Limited per visitor, and by the
// daily spend cap, past which code's fallback answers (and says so). The same
// case and reply again is answered from the cache, free.

export const maxDuration = 60;

const PER_HOUR = 6;
const PER_DAY = 20;

const Body = z.object({ case: z.string().max(40), reply: z.string().trim().max(280).nullable() });

export type DemoReply = {
  response: RebuildResponse;
  steps: unknown[];
  turns: number;
  cost_usd: number;
  latency_s: number;
  fell_back: string | null;
  cached: boolean;
};

const fail = (status: number, error: string, headers: Record<string, string> = {}) =>
  Response.json({ error }, { status, headers });

export async function POST(request: Request): Promise<Response> {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail(400, "Pick a case and type a reply (or leave it empty for no reply).");
  const demo = REBUILDS.find((r) => r.name === body.data.case);
  if (!demo) return fail(404, "There's no such demo case.");
  const base = RebuildRequest.parse(demo.request);
  const req: RebuildRequest = { ...base, missed: { ...base.missed, reply: body.data.reply || null } };

  const env = readEnv();
  const kv = kvFor(env);
  const cache = contentCache(kv, `rebuild-demo|${REBUILD_VERSION}|${env.MUSE_SPARK_MODEL}`);
  const key = JSON.stringify(req);
  const hit = await cache.get<Omit<DemoReply, "cached">>(key).catch(() => null);
  if (hit) return Response.json({ ...hit, cached: true } satisfies DemoReply);
  if (!env.META_API_KEY)
    return fail(503, "Live runs aren't set up on this copy of Lens. The recorded runs still work.");

  try {
    const visitor =
      request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
    await rateLimit(kv, visitor.trim(), { perHour: PER_HOUR, perDay: PER_DAY }, new Date(), "rebuild");
  } catch (e) {
    if (e instanceof RateLimited)
      return fail(429, "That's a lot of live runs in a short time. The recorded runs are still free to try.", {
        "Retry-After": String(e.retryAfterSeconds),
      });
    throw e;
  }

  const run = await rebuild(req, { env, budgetMs: 40_000 });
  const response = checkResponse(req, run.response).length ? fallback(req).response("fallback") : run.response;
  const out: Omit<DemoReply, "cached"> = {
    response,
    steps: run.steps,
    turns: run.turns,
    cost_usd: run.calls.reduce((a, c) => a + c.costUsd, 0),
    latency_s: run.calls.reduce((a, c) => a + c.latencyMs, 0) / 1000,
    fell_back: run.fellBack,
  };
  if (response.decided_by === "agent") await cache.set(key, out).catch(() => {});
  console.info(
    JSON.stringify({
      event: "rebuild_demo",
      decided_by: response.decided_by,
      fell_back: run.fellBack,
      turns: run.turns,
      cost_usd: Number(out.cost_usd.toFixed(6)),
    }),
  );
  return Response.json({ ...out, cached: false } satisfies DemoReply);
}
