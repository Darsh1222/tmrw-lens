import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import REBUILD_CASES from "@/lib/demo/rebuilds.json";
import { readEnv } from "@/lib/env";
import {
  admit,
  callsKey,
  type CounterStore,
  bucketsFor,
  counterStoreFor,
  LimitReached,
  MemoryCounterStore,
  poolCapUsd,
  poolKey,
  SpendGuard,
  spendGuardFor,
  untilTomorrow,
  type Payer,
} from "@/lib/meta/spend";
import { RebuildRequest } from "@/lib/rebuild/contract";
import { isOwner, LIMITS, ownerCookie, tomorrowPayer, VISITOR_COOKIE, visitorPayer } from "@/lib/server/identity";

const env = readEnv({});
const user = (key: string, calls = 3, usd = 1): Payer => ({ pool: "tomorrow", accounts: [{ key, calls, usd }] });
const limit = (e: unknown) => (e instanceof LimitReached ? e.code : e);

describe("SpendGuard", () => {
  it("reserves, then settles to the actual cost", async () => {
    const g = new SpendGuard(new MemoryCounterStore(), bucketsFor(undefined, 1));
    const r = await g.reserve(0.4);
    expect(await g.spentToday()).toBeCloseTo(0.4);
    await r.settle(0.1);
    expect(await g.spentToday()).toBeCloseTo(0.1);
    await r.settle(0.3); // second settle is ignored
    expect(await g.spentToday()).toBeCloseTo(0.1);
  });

  it("refuses a reservation that would pass the cap and leaves the total unchanged", async () => {
    const g = new SpendGuard(new MemoryCounterStore(), bucketsFor(undefined, 1));
    await g.reserve(0.7);
    expect(limit(await g.reserve(0.4).catch((e) => e))).toBe("global_limit");
    expect(await g.spentToday()).toBeCloseTo(0.7);
  });

  it("can't be overshot by calls reserving at the same time", async () => {
    const g = new SpendGuard(new MemoryCounterStore(), bucketsFor(undefined, 1));
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => g.reserve(0.3)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await g.spentToday()).toBeLessThanOrEqual(1);
  });

  it("starts a new total each UTC day, and says when", async () => {
    let now = new Date("2026-10-28T23:59:00Z");
    const g = new SpendGuard(new MemoryCounterStore(), bucketsFor(undefined, 1), () => now);
    await g.reserve(0.9);
    expect(((await g.reserve(0.9).catch((e) => e)) as LimitReached).retryAfterSeconds).toBe(60);
    now = new Date("2026-10-29T00:01:00Z");
    await expect(g.reserve(0.9)).resolves.toBeDefined();
    expect(poolKey("public", now)).toBe("lens:spend:public:2026-10-29");
    expect(untilTomorrow(new Date("2026-10-29T12:00:00Z"))).toBe(43_200);
  });

  it("charges the identity's dollars first: past them is user_limit, and the pool's total is untouched", async () => {
    const store: CounterStore = new MemoryCounterStore();
    const g = new SpendGuard(store, bucketsFor(user("u1", 30, 0.5), 20));
    await (await g.reserve(0.3)).settle(0.3);
    expect(limit(await g.reserve(0.3).catch((e) => e))).toBe("user_limit");
    expect(await g.spentToday()).toBeCloseTo(0.3);
    expect(await g.spentToday(0)).toBeCloseTo(0.3);
    // Another person still has their own.
    await expect(new SpendGuard(store, bucketsFor(user("u2", 30, 0.5), 20)).reserve(0.3)).resolves.toBeDefined();
  });

  it("stops everyone in a pool at its brake (global_limit), and only that pool", async () => {
    const store: CounterStore = new MemoryCounterStore();
    const visitor: Payer = { pool: "public", accounts: [{ key: "v1", ...LIMITS.visitor }] };
    await store.add(poolKey("public", new Date()), 5, 60);
    expect(limit(await new SpendGuard(store, bucketsFor(visitor, 5)).reserve(0.01).catch((e) => e))).toBe("global_limit"); // prettier-ignore
    // Demo traffic can't use up Tomorrow's budget.
    await expect(new SpendGuard(store, bucketsFor(user("u1"), 20)).reserve(0.01)).resolves.toBeDefined();
  });
});

describe("admit (one metered request)", () => {
  it("counts calls per identity and refuses the one past the limit, without counting it", async () => {
    const store: CounterStore = new MemoryCounterStore();
    const p = user("u1", 3);
    for (let n = 0; n < 3; n++) await admit(store, p, 20);
    expect(limit(await admit(store, p, 20).catch((e) => e))).toBe("user_limit");
    expect(limit(await admit(store, p, 20).catch((e) => e))).toBe("user_limit");
    expect(await store.add("lens:calls:tomorrow:u1:" + new Date().toISOString().slice(0, 10), 0, 60)).toBe(3);
    await expect(admit(store, user("u2", 3), 20)).resolves.toBeUndefined();
  });

  it("refuses an identity whose dollars are spent, and everyone once the pool's brake is on", async () => {
    const store: CounterStore = new MemoryCounterStore();
    const now = new Date();
    await new SpendGuard(store, bucketsFor(user("u1", 30, 0.5), 20)).reserve(0.5);
    expect(limit(await admit(store, user("u1", 30, 0.5), 20, now).catch((e) => e))).toBe("user_limit");
    await store.add(poolKey("tomorrow", now), 20, 60);
    expect(limit(await admit(store, user("u3", 30, 0.5), 20, now).catch((e) => e))).toBe("global_limit");
  });

  it("holds a visitor to 25 a day, and an address to 75 however many cookies it collects", async () => {
    const store: CounterStore = new MemoryCounterStore();
    const at = (cookie: string | null, ip = "198.51.100.4") =>
      visitorPayer(env, new Request("http://lens.test/api/read", { headers: { "x-real-ip": ip, ...(cookie && { cookie }) } })); // prettier-ignore
    const first = at(null);
    const cookie = first.setCookie!.split(";")[0];
    expect(LIMITS.visitor).toEqual({ calls: 25, usd: 0.4 });
    expect(LIMITS.address).toEqual({ calls: 75, usd: 1.5 });
    for (let n = 0; n < 25; n++) await admit(store, at(cookie).payer, 5);
    expect(limit(await admit(store, at(cookie).payer, 5).catch((e) => e))).toBe("user_limit");
    // A fresh cookie is a fresh visitor, until the address's own allowance runs out.
    let admitted = 25;
    for (let n = 0; n < 80; n++) {
      const fresh = at(null).setCookie!.split(";")[0];
      const ok = await admit(store, at(fresh).payer, 5).then(() => true, () => false); // prettier-ignore
      if (ok) admitted += 1;
    }
    expect(admitted).toBe(LIMITS.address.calls);
    // Another address is someone else.
    await expect(admit(store, at(null, "198.51.100.5").payer, 5)).resolves.toBeUndefined();
  });
});

describe("identities", () => {
  it("hashes a Tomorrow user's ref; the ref itself is never in a key", () => {
    const p = tomorrowPayer(env, "user_0001");
    expect(p).toEqual(tomorrowPayer(env, "user_0001"));
    expect(p.accounts[0]).toMatchObject({ calls: 30, usd: 0.5 });
    expect(JSON.stringify(p)).not.toContain("user_0001");
    expect(tomorrowPayer(env, "user_0002").accounts[0].key).not.toBe(p.accounts[0].key);
  });

  it("gives a visitor a signed cookie, keeps it, and doesn't accept a forged one", () => {
    const req = (cookie?: string) =>
      new Request("http://lens.test/", { headers: { "x-real-ip": "198.51.100.9", ...(cookie && { cookie }) } });
    const first = visitorPayer(env, req());
    expect(first.setCookie).toMatch(new RegExp(`^${VISITOR_COOKIE}=[\\w-]+\\.[0-9a-f]{24}; Path=/; .*HttpOnly; SameSite=Lax`)); // prettier-ignore
    const cookie = first.setCookie!.split(";")[0];
    const again = visitorPayer(env, req(`theme=dark; ${cookie}`));
    expect(again.setCookie).toBeNull();
    expect(again.payer.accounts[0].key).toBe(visitorPayer(env, req(cookie)).payer.accounts[0].key);
    const forged = visitorPayer(env, req(cookie.replace(/\.[0-9a-f]{24}$/, `.${"0".repeat(24)}`)));
    expect(forged.setCookie).not.toBeNull();
    expect(JSON.stringify(again.payer)).not.toContain("198.51.100.9");
  });

  it("reads the public brake from PUBLIC_DAILY_CAP_USD, then DAILY_SPEND_CAP_USD, then 5", () => {
    expect(poolCapUsd(readEnv({}), "public")).toBe(5);
    expect(poolCapUsd(readEnv({ DAILY_SPEND_CAP_USD: "3" }), "public")).toBe(3);
    expect(poolCapUsd(readEnv({ DAILY_SPEND_CAP_USD: "3", PUBLIC_DAILY_CAP_USD: "2" }), "public")).toBe(2);
    expect(poolCapUsd(readEnv({}), "tomorrow")).toBe(20);
    expect(poolCapUsd(readEnv({ TOMORROW_DAILY_CAP_USD: "40" }), "tomorrow")).toBe(40);
  });

  it("refuses to run deployed without shared counters", () => {
    const holder = globalThis as { __lensCounters?: unknown };
    const kept = holder.__lensCounters;
    delete holder.__lensCounters;
    expect(() => spendGuardFor(readEnv({ VERCEL_ENV: "production" }))).toThrow(/UPSTASH/);
    holder.__lensCounters = kept;
  });
});

describe("POST /api/rebuild limits", () => {
  const SECRET = "s".repeat(40);
  const base = RebuildRequest.parse(REBUILD_CASES.find((c) => c.name === "simple-move")!.request);
  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/rebuild/route");
    return POST(
      new Request("http://lens.test/api/rebuild", {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify(body),
      }),
    );
  };
  beforeEach(() => {
    vi.stubEnv("LENS_REBUILD_SECRET", SECRET);
    vi.stubEnv("META_API_KEY", "test-key");
    // Every model call fails, so each run falls back to code (and isn't cached): each one counts.
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "no", type: "invalid_request_error" } }), { status: 400 }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answers user_limit after 30 runs for one person, and leaves other people alone", async () => {
    const store = counterStoreFor(readEnv());
    const payer = tomorrowPayer(readEnv(), "user_limit_test");
    for (let n = 0; n < LIMITS.tomorrowUser.calls; n++) await admit(store, payer, 20);
    const res = await post({ ...base, user_ref: "user_limit_test" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "user_limit" });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post({ ...base, user_ref: "someone_else" })).status).toBe(200);
  });

  it("charges a request without user_ref to the shared tomorrow-unknown identity, never a 422", async () => {
    const res = await post(base);
    expect(res.status).toBe(200);
    const who = tomorrowPayer(readEnv(), undefined).accounts[0];
    expect(who.key).toBe("tomorrow-unknown");
    expect(await counterStoreFor(readEnv()).add(callsKey("tomorrow", who, new Date()), 0, 60)).toBe(1);
    // Only Tomorrow's brake limits it: past one person's 30 a day, it still runs.
    for (let n = 0; n < LIMITS.tomorrowUser.calls; n++) await admit(counterStoreFor(readEnv()), tomorrowPayer(readEnv(), null), 20); // prettier-ignore
    expect((await post({ ...base, now: "2026-11-04T18:12:00-05:00" })).status).toBe(200);
  });

  it("answers global_limit once Tomorrow's brake is on", async () => {
    vi.stubEnv("TOMORROW_DAILY_CAP_USD", "0.01");
    await counterStoreFor(readEnv()).add(poolKey("tomorrow", new Date()), 0.01, 60);
    const res = await post({ ...base, user_ref: "user_global_test" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "global_limit" });
  });
});

describe("the owner", () => {
  const KEY = "k".repeat(32);
  const owned = readEnv({ OWNER_KEY: KEY });
  afterEach(() => vi.unstubAllEnvs());
  const visit = async (key: string | null) => {
    const { GET } = await import("@/app/owner/route");
    return GET(new Request(`http://lens.test/owner${key === null ? "" : `?key=${key}`}`));
  };

  it("gets a signed cookie from /owner with the right key, and a plain 404 otherwise", async () => {
    vi.stubEnv("OWNER_KEY", KEY);
    const ok = await visit(KEY);
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/");
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^lens_owner=[0-9a-f]{64}; Path=\/; .*HttpOnly; SameSite=Lax/);
    expect(cookie).not.toContain(KEY);
    for (const wrong of ["nope", KEY.slice(1), null]) {
      const r = await visit(wrong);
      expect(r.status).toBe(404);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    vi.stubEnv("OWNER_KEY", "");
    expect((await visit(KEY)).status).toBe(404);
  });

  it("skips the per-visitor and per-address limits, but not the public brake, and is logged as owner", async () => {
    const cookie = ownerCookie(owned).split(";")[0];
    const req = new Request("http://lens.test/api/read", { headers: { "x-real-ip": "198.51.100.77", cookie } });
    const { payer, setCookie } = visitorPayer(owned, req);
    expect(setCookie).toBeNull();
    expect(payer).toEqual({ pool: "public", accounts: [{ key: "owner", calls: Infinity, usd: Infinity }] });
    const store: CounterStore = new MemoryCounterStore();
    for (let n = 0; n < LIMITS.address.calls + 5; n++) await admit(store, payer, 5);
    await expect(new SpendGuard(store, bucketsFor(payer, 5)).reserve(4.9)).resolves.toBeDefined();
    expect(limit(await new SpendGuard(store, bucketsFor(payer, 5)).reserve(0.2).catch((e) => e))).toBe("global_limit");
    await store.add(poolKey("public", new Date()), 0.1, 60); // the pool reaches its $5
    expect(limit(await admit(store, payer, 5).catch((e) => e))).toBe("global_limit");
    // A forged cookie, or the cookie on a deployment with another key, is an ordinary visitor.
    const other = readEnv({ OWNER_KEY: "z".repeat(32) });
    expect(visitorPayer(other, req).payer.accounts[0].key).not.toBe("owner");
    expect(isOwner(readEnv({}), req)).toBe(false);
  });
});
