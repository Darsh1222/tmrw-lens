import type { Env } from "@/lib/env";

// The hard daily cap on model spend, shared by every visitor. Each call reserves
// its worst case before it is sent and settles to the real cost afterwards, so
// concurrent calls can't overshoot the cap between check and record.

export interface CounterStore {
  /** Atomically add `delta` to `key` and return the new total. */
  add(key: string, delta: number, ttlSeconds: number): Promise<number>;
}

export class SpendCapReached extends Error {
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(`Daily spend cap reached ($${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)})`);
    this.name = "SpendCapReached";
  }
}

export class MemoryCounterStore implements CounterStore {
  private totals = new Map<string, number>();
  async add(key: string, delta: number): Promise<number> {
    const next = (this.totals.get(key) ?? 0) + delta;
    this.totals.set(key, next);
    return next;
  }
}

// Upstash Redis over its REST API: plain fetch, no client library.
export class UpstashCounterStore implements CounterStore {
  constructor(
    private url: string,
    private token: string,
  ) {}
  async add(key: string, delta: number, ttlSeconds: number): Promise<number> {
    const res = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCRBYFLOAT", key, String(delta)],
        ["EXPIRE", key, String(ttlSeconds)],
      ]),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const body = (await res.json()) as [{ result?: string; error?: string }, unknown];
    if (body[0]?.error !== undefined || body[0]?.result === undefined) throw new Error("Upstash INCRBYFLOAT failed");
    return Number(body[0].result);
  }
}

const DAY_SECONDS = 86_400;

/** Cap days are UTC days. */
export function spendKey(now: Date = new Date()): string {
  return `lens:spend:${now.toISOString().slice(0, 10)}`;
}

export class SpendGuard {
  constructor(
    private store: CounterStore,
    readonly capUsd: number,
    private now: () => Date = () => new Date(),
  ) {}

  async reserve(usd: number): Promise<Reservation> {
    const key = spendKey(this.now());
    const total = await this.store.add(key, usd, 2 * DAY_SECONDS);
    if (total > this.capUsd) {
      await this.store.add(key, -usd, 2 * DAY_SECONDS);
      throw new SpendCapReached(total - usd, this.capUsd);
    }
    let settled = false;
    return {
      reservedUsd: usd,
      settle: async (actualUsd: number) => {
        if (settled) return;
        settled = true;
        if (actualUsd !== usd) await this.store.add(key, actualUsd - usd, 2 * DAY_SECONDS);
      },
    };
  }

  async spentToday(): Promise<number> {
    return this.store.add(spendKey(this.now()), 0, 2 * DAY_SECONDS);
  }
}

export type Reservation = { reservedUsd: number; settle(actualUsd: number): Promise<void> };

let shared: SpendGuard | undefined;

export function spendGuardFor(env: Env): SpendGuard {
  if (shared) return shared;
  const deployed = env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
  let store: CounterStore;
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    store = new UpstashCounterStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  } else if (deployed) {
    // Each serverless instance would have its own in-memory total, so the cap
    // wouldn't be a cap. Refuse model calls instead of failing open.
    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required when deployed");
  } else {
    store = new MemoryCounterStore();
  }
  shared = new SpendGuard(store, env.DAILY_SPEND_CAP_USD);
  return shared;
}
