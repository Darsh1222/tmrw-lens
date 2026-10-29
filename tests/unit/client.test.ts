import { describe, expect, it } from "vitest";
import { readEnv } from "@/lib/env";
import { createResponse, MetaApiError, MetaIncomplete } from "@/lib/meta/client";
import { MemoryCounterStore, SpendGuard } from "@/lib/meta/spend";

const env = readEnv({ META_API_KEY: "test-key" });

const ok = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: "resp_1",
      model: "muse-spark-1.3",
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] }],
      usage: {
        input_tokens: 1_000,
        output_tokens: 500,
        input_tokens_details: { cached_tokens: 200 },
        output_tokens_details: { reasoning_tokens: 300 },
      },
      ...overrides,
    }),
    { status: 200 },
  );

const err = (status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { message: "nope", type: "server_error", code: "service_overloaded" } }), {
    status,
    headers,
  });

function harness(responses: Response[], cap = 1) {
  const sent: RequestInit[] = [];
  const lines: Record<string, unknown>[] = [];
  const store = new MemoryCounterStore();
  const guard = new SpendGuard(store, cap);
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    sent.push(init);
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  }) as unknown as typeof fetch;
  return {
    sent,
    lines,
    guard,
    opts: {
      task: "unit",
      env,
      guard,
      fetchImpl,
      log: (l: Record<string, unknown>) => lines.push(l),
      sleep: async () => {},
    },
  };
}

const req = { model: "muse-spark-1.3", input: "secret user words", max_output_tokens: 1_000 };

describe("createResponse", () => {
  it("returns text, usage, and cost, and settles the spend to the real cost", async () => {
    const h = harness([ok()]);
    const r = await createResponse(req, h.opts);
    expect(r.outputText).toBe("hello");
    expect(r.usage).toEqual({ input_tokens: 1_000, output_tokens: 500, cached_tokens: 200, reasoning_tokens: 300 });
    // 800 uncached * 1.25 + 200 cached * 0.15 + 500 out * 4.25, per million.
    expect(r.costUsd).toBeCloseTo((800 * 1.25 + 200 * 0.15 + 500 * 4.25) / 1e6, 10);
    expect(await h.guard.spentToday()).toBeCloseTo(r.costUsd, 10);
  });

  it("sends store:false and the bearer key", async () => {
    const h = harness([ok()]);
    await createResponse(req, h.opts);
    expect(JSON.parse(h.sent[0].body as string).store).toBe(false);
    expect((h.sent[0].headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("never logs content", async () => {
    const h = harness([ok()]);
    await createResponse(req, h.opts);
    const logged = JSON.stringify(h.lines);
    expect(logged).not.toContain("secret user words");
    expect(logged).not.toContain("hello");
    expect(h.lines[0]).toMatchObject({ event: "meta_call", task: "unit", status: "completed", attempts: 1 });
  });

  it("retries a 429 and a 503, then succeeds", async () => {
    const h = harness([err(429, { "retry-after": "1" }), err(503), ok()]);
    const r = await createResponse(req, h.opts);
    expect(r.attempts).toBe(3);
  });

  it("does not retry a 400", async () => {
    const h = harness([err(400), ok()]);
    await expect(createResponse(req, h.opts)).rejects.toBeInstanceOf(MetaApiError);
    expect(h.sent).toHaveLength(1);
    expect(await h.guard.spentToday()).toBe(0);
  });

  it("gives up rather than wait out a long Retry-After", async () => {
    const h = harness([err(503, { "retry-after": "60" }), ok()]);
    await expect(createResponse(req, { ...h.opts, maxRetryWaitMs: 5_000 })).rejects.toBeInstanceOf(MetaApiError);
    expect(h.sent).toHaveLength(1);
  });

  it("retries a network failure", async () => {
    const h = harness([ok()]);
    let first = true;
    const flaky = (async (url: string, init: RequestInit) => {
      if (first) {
        first = false;
        throw new TypeError("fetch failed");
      }
      return h.opts.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const r = await createResponse(req, { ...h.opts, fetchImpl: flaky });
    expect(r.attempts).toBe(2);
  });

  it("reports an incomplete response but still records what it cost", async () => {
    const h = harness([ok({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })]);
    const e = await createResponse(req, h.opts).catch((x) => x);
    expect(e).toBeInstanceOf(MetaIncomplete);
    expect(await h.guard.spentToday()).toBeGreaterThan(0);
  });

  it("refuses before sending when the cap would be exceeded", async () => {
    const h = harness([ok()], 0.000001);
    await expect(createResponse(req, h.opts)).rejects.toThrow(/cap/);
    expect(h.sent).toHaveLength(0);
  });
});
