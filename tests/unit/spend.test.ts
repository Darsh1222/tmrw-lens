import { describe, expect, it } from "vitest";
import { MemoryCounterStore, SpendCapReached, SpendGuard, spendKey, spendGuardFor } from "@/lib/meta/spend";
import { readEnv } from "@/lib/env";

describe("SpendGuard", () => {
  it("reserves, then settles to the actual cost", async () => {
    const g = new SpendGuard(new MemoryCounterStore(), 1);
    const r = await g.reserve(0.4);
    expect(await g.spentToday()).toBeCloseTo(0.4);
    await r.settle(0.1);
    expect(await g.spentToday()).toBeCloseTo(0.1);
    await r.settle(0.3); // second settle is ignored
    expect(await g.spentToday()).toBeCloseTo(0.1);
  });

  it("refuses a reservation that would pass the cap and leaves the total unchanged", async () => {
    const g = new SpendGuard(new MemoryCounterStore(), 1);
    await g.reserve(0.7);
    await expect(g.reserve(0.4)).rejects.toBeInstanceOf(SpendCapReached);
    expect(await g.spentToday()).toBeCloseTo(0.7);
  });

  it("can't be overshot by calls reserving at the same time", async () => {
    const g = new SpendGuard(new MemoryCounterStore(), 1);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => g.reserve(0.3)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await g.spentToday()).toBeLessThanOrEqual(1);
  });

  it("starts a new total each UTC day", async () => {
    let now = new Date("2026-10-28T23:59:00Z");
    const g = new SpendGuard(new MemoryCounterStore(), 1, () => now);
    await g.reserve(0.9);
    now = new Date("2026-10-29T00:01:00Z");
    await expect(g.reserve(0.9)).resolves.toBeDefined();
    expect(spendKey(now)).toBe("lens:spend:2026-10-29");
  });

  it("refuses to run deployed without a shared counter", () => {
    expect(() => spendGuardFor(readEnv({ VERCEL_ENV: "production" }))).toThrow(/UPSTASH/);
  });
});
