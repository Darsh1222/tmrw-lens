import { describe, expect, it } from "vitest";
import { RebuildRequest, type RebuildResponse } from "@/lib/rebuild/contract";
import { Draft, fallback } from "@/lib/rebuild/draft";
import { rankSlots } from "@/lib/rebuild/rank";
import { hardRuleViolations, messageTimes, missGap } from "@/lib/rebuild/rules";
import { REBUILD_CASES } from "../../evals/rebuild/cases";

const req = (name: string) => RebuildRequest.parse(REBUILD_CASES.find((c) => c.name === name)!.request);
const at = (r: RebuildRequest, local: string) => new Draft(r).parseLocal(local) as number;

/** A rebuild that moves the missed item to `start` for `minutes`, with code's message for it. */
function moved(r: RebuildRequest, start: string, minutes = 60): RebuildResponse {
  const d = new Draft(r);
  const s = at(r, start);
  d.changes.set(r.missed.item_id, { action: "move", start: s, end: s + minutes * 60_000, reason: "it's free then" });
  return d.response("agent");
}

describe("hard rules", () => {
  // Live bug #1: missed 8:30-9:30pm Tuesday, moved to 10:30pm the same night (bedtime 11:30, quiz Thursday).
  const live = req("live-1030pm-same-night");

  it("catches tonight's 10:30pm move: the hour before bed, and within 90 minutes of the miss", () => {
    const bad = hardRuleViolations(live, moved(live, "2026-11-10T22:30"));
    expect(bad).toContain("s_calc: in sleep, the hour before bed, or quiet hours");
    expect(bad).toContain("s_calc: within 90 min of the missed session");
    expect(hardRuleViolations(live, moved(live, "2026-11-11T07:30"))).toEqual([]);
  });

  it("and the Draft refuses it, saying why", () => {
    const d = new Draft(live);
    expect(d.move("s_calc", "2026-11-10T22:30", null, "it's free then")).toMatchObject({ ok: false, problem: expect.stringMatching(/90 minutes/) }); // prettier-ignore
    expect(d.move("s_calc", "2026-11-10T23:00", null, "it's free then")).toMatchObject({ ok: false, problem: expect.stringMatching(/bedtime/) }); // prettier-ignore
    expect(d.move("s_calc", "2026-11-11T07:30", null, "it's free then")).toMatchObject({ ok: true });
  });

  it("allows right after the miss when it's due within 24 hours", () => {
    const urgent = req("due-in-4h-right-after-miss");
    expect(missGap(urgent)).toBeNull();
    expect(hardRuleViolations(urgent, moved(urgent, "2026-11-12T18:05"))).toEqual([]);
  });

  it("catches overlaps with classes, other items, and quiet hours, and moves after the deadline or in the past", () => {
    const r = req("quiet-dinner");
    expect(hardRuleViolations(r, moved(r, "2026-11-11T13:00")).join()).toMatch(/overlaps PHYS161 lecture/);
    expect(hardRuleViolations(r, moved(r, "2026-11-10T18:30")).join()).toMatch(/quiet hours/);
    expect(hardRuleViolations(r, moved(r, "2026-11-14T08:00")).join()).toMatch(/after it's due/);
    expect(hardRuleViolations(r, moved(r, "2026-11-09T09:00")).join()).toMatch(/in the past/);
    const two = req("two-misses-second");
    expect(hardRuleViolations(two, moved(two, "2026-11-09T20:00")).join()).toMatch(/overlaps s_phys2/);
  });

  it("checks the message on its own: its times, its last words, and that only changed items are named", () => {
    const r = live;
    const good = moved(r, "2026-11-11T07:30");
    expect(hardRuleViolations(r, { ...good, message: good.message.replace("7:30am", "8:30am") })).toContain("message: its times aren't exactly the moves' times"); // prettier-ignore
    expect(hardRuleViolations(r, { ...good, message: good.message.replace(" Nothing else changed.", "") })).toContain('message: doesn\'t end "Nothing else changed."'); // prettier-ignore
    expect(hardRuleViolations(r, { ...good, message: `${good.message.replace(" Nothing else changed.", "")} Essay outline stays. Nothing else changed.` })).toContain('message: names "Essay outline", which didn\'t change'); // prettier-ignore
  });

  it("reads every way a message names a time", () => {
    const r = live; // now: Tue Nov 10, 9:35pm
    const ms = (local: string) => at(r, local);
    expect(messageTimes(r, "Moved A to 7pm today because x. Nothing else changed.")).toEqual([ms("2026-11-10T19:00")]);
    expect(messageTimes(r, "Moved A to 9:30am tomorrow because x.")).toEqual([ms("2026-11-11T09:30")]);
    expect(messageTimes(r, "Moved A to Thu 4pm because x.")).toEqual([ms("2026-11-12T16:00")]);
    expect(messageTimes(r, "Moved A to Thu Nov 19, 4pm because x.")).toEqual([ms("2026-11-19T16:00")]);
    expect(messageTimes(r, "Feel better. Moved A to 8am, B to 2pm and C to 3pm tomorrow.")).toEqual(["08:00", "14:00", "15:00"].map((t) => ms(`2026-11-11T${t}`))); // prettier-ignore
    expect(messageTimes(r, "Moved A to 4pm because x.")).toMatch(/no day/);
  });

  it("code's fallback keeps every hard rule in every case", () => {
    for (const c of REBUILD_CASES) {
      const r = RebuildRequest.parse(c.request);
      expect([c.name, hardRuleViolations(r, fallback(r).response("fallback"))]).toEqual([c.name, []]);
    }
  });
});

describe("placement ranking (the oracle)", () => {
  it("puts tonight's live-bug session in the morning, never in the hour before bed", () => {
    const r = req("live-1030pm-same-night");
    const top = rankSlots(new Draft(r), "s_calc")[0];
    expect(new Draft(r).stamp(top.start)).toBe("2026-11-11T07:30");
  });

  it("prefers their study time, a lighter day, and the full length", () => {
    const morning = rankSlots(new Draft(req("morning-person")), "s_phys")[0];
    const night = rankSlots(new Draft(req("night-person")), "s_phys")[0];
    expect(new Draft(req("morning-person")).local(morning.start).hour).toBeLessThan(12);
    expect(new Draft(req("night-person")).local(night.start).hour).toBeGreaterThanOrEqual(17);
    const heavy = new Draft(req("heavy-tomorrow-light-after"));
    expect(heavy.local(rankSlots(heavy, "s_phys")[0].start).weekday).not.toBe(3); // not packed Wednesday
    const short = rankSlots(new Draft(req("shorten")), "s_review");
    expect(short[0].minutes).toBe(60);
  });

  it("never offers a stretch shorter than the session", () => {
    for (const c of REBUILD_CASES) {
      const r = RebuildRequest.parse(c.request);
      for (const x of rankSlots(new Draft(r), r.missed.item_id)) expect(x.e - x.start).toBeGreaterThanOrEqual(x.minutes * 60_000); // prettier-ignore
    }
  });
});
