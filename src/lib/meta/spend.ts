import { AsyncLocalStorage } from "node:async_hooks";
import type { Env } from "@/lib/env";

// Who pays for a model call, and the daily limits that stop them. Every metered
// request is charged to an identity (a Tomorrow user, or a public visitor) with
// its own calls and dollars per UTC day; behind those, two global brakes, one
// per pool, so demo traffic can never use up what Tomorrow's users need. A
// cached answer never reaches a model, so it is never counted.
//
// Each model call reserves its worst case on every bucket before it is sent and
// settles to the real cost afterwards, so concurrent calls can't overshoot a
// limit between check and record. Identities are hashed before they get here
// (src/lib/server/identity.ts); the counters hold no personal data.

export interface CounterStore {
  /** Atomically add `delta` to `key` and return the new total. */
  add(key: string, delta: number, ttlSeconds: number): Promise<number>;
}

export type Pool = "public" | "tomorrow";
export type LimitCode = "user_limit" | "global_limit";

/** One identity's daily allowance. `key` is already hashed. */
export type Account = { key: string; calls: number; usd: number };
export type Payer = { pool: Pool; accounts: Account[] };

export class LimitReached extends Error {
  constructor(
    readonly code: LimitCode,
    readonly retryAfterSeconds: number,
  ) {
    super(code === "user_limit" ? "Daily limit reached for this identity" : "Daily spend cap reached for this pool");
    this.name = "LimitReached";
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
const TTL = 2 * DAY_SECONDS;

/** Limit days are UTC days. */
const dayOf = (now: Date) => now.toISOString().slice(0, 10);

export function untilTomorrow(now: Date): number {
  return Math.max(60, DAY_SECONDS - Math.floor((now.getTime() % (DAY_SECONDS * 1000)) / 1000));
}

export const poolKey = (pool: Pool, now: Date) => `lens:spend:${pool}:${dayOf(now)}`;
export const usdKey = (pool: Pool, a: Account, now: Date) => `lens:usd:${pool}:${a.key}:${dayOf(now)}`;
export const callsKey = (pool: Pool, a: Account, now: Date) => `lens:calls:${pool}:${a.key}:${dayOf(now)}`;

/** The pool's global brake. PUBLIC_DAILY_CAP_USD falls back to the older DAILY_SPEND_CAP_USD, then 5. */
export function poolCapUsd(env: Env, pool: Pool): number {
  return pool === "tomorrow" ? env.TOMORROW_DAILY_CAP_USD : (env.PUBLIC_DAILY_CAP_USD ?? env.DAILY_SPEND_CAP_USD ?? 5);
}

/** A dollar total with a cap; a reservation that would pass it is refused with `code`. */
export type Bucket = { key: (now: Date) => string; capUsd: number; code: LimitCode };

export function bucketsFor(payer: Payer | undefined, capUsd: number): Bucket[] {
  const pool = payer?.pool ?? "public";
  return [
    ...(payer?.accounts ?? []).map((a): Bucket => ({ key: (n) => usdKey(pool, a, n), capUsd: a.usd, code: "user_limit" })), // prettier-ignore
    { key: (n) => poolKey(pool, n), capUsd, code: "global_limit" },
  ];
}

export class SpendGuard {
  constructor(
    private store: CounterStore,
    private buckets: Bucket[],
    private now: () => Date = () => new Date(),
  ) {}

  async reserve(usd: number): Promise<Reservation> {
    const now = this.now();
    const keys = this.buckets.map((b) => b.key(now));
    for (const [n, b] of this.buckets.entries()) {
      const total = await this.store.add(keys[n], usd, TTL);
      if (total > b.capUsd) {
        await Promise.all(keys.slice(0, n + 1).map((k) => this.store.add(k, -usd, TTL)));
        throw new LimitReached(b.code, untilTomorrow(now));
      }
    }
    let settled: Promise<number[]> | null = null;
    return {
      reservedUsd: usd,
      settle: (actualUsd: number) =>
        (settled ??= Promise.all(keys.map((k) => this.store.add(k, actualUsd - usd, TTL)))),
    };
  }

  /** Today's total in one bucket (the last is the pool's). */
  async spentToday(bucket = this.buckets.length - 1): Promise<number> {
    return this.store.add(this.buckets[bucket].key(this.now()), 0, TTL);
  }
}

/** `settle` resolves to each bucket's total after settling, the identity's first. */
export type Reservation = { reservedUsd: number; settle(actualUsd: number): Promise<number[]> };

const holder = globalThis as { __lensCounters?: CounterStore };

export function counterStoreFor(env: Env): CounterStore {
  if (holder.__lensCounters) return holder.__lensCounters;
  const deployed = env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN)
    holder.__lensCounters = new UpstashCounterStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  else if (deployed)
    // Each serverless instance would have its own in-memory totals, so a limit
    // wouldn't be a limit. Refuse model calls instead of failing open.
    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required when deployed");
  else holder.__lensCounters = new MemoryCounterStore();
  return holder.__lensCounters;
}

// The payer travels with the request, so every model call it makes (however
// deep in a task) is charged to them without threading it through each layer.
const payers = new AsyncLocalStorage<Payer>();

export const chargeTo = <T>(payer: Payer, run: () => Promise<T>): Promise<T> => payers.run(payer, run);
export const currentPayer = (): Payer | undefined => payers.getStore();

/** The guard for a call: the payer's own buckets, then their pool's brake. Scripts (no payer) use the public pool's. */
export function spendGuardFor(env: Env, payer = currentPayer()): SpendGuard {
  return new SpendGuard(counterStoreFor(env), bucketsFor(payer, poolCapUsd(env, payer?.pool ?? "public")));
}

/**
 * A metered request is starting (nothing cached could answer it): count it against each of the payer's accounts.
 * Refused, and not counted, when an account is out of calls or dollars or the pool's brake is on.
 */
export async function admit(store: CounterStore, payer: Payer, capUsd: number, now: Date = new Date()): Promise<void> {
  const wait = untilTomorrow(now);
  if ((await store.add(poolKey(payer.pool, now), 0, TTL)) >= capUsd) throw new LimitReached("global_limit", wait);
  for (const a of payer.accounts)
    if ((await store.add(usdKey(payer.pool, a, now), 0, TTL)) >= a.usd) throw new LimitReached("user_limit", wait);
  const counted: string[] = [];
  for (const a of payer.accounts) {
    const key = callsKey(payer.pool, a, now);
    counted.push(key);
    if ((await store.add(key, 1, TTL)) > a.calls) {
      await Promise.all(counted.map((k) => store.add(k, -1, TTL)));
      throw new LimitReached("user_limit", wait);
    }
  }
}

export const admitFor = (env: Env, payer: Payer) => admit(counterStoreFor(env), payer, poolCapUsd(env, payer.pool));
