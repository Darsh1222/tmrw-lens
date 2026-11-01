import { afterEach, describe, expect, it, vi } from "vitest";
import { readEnv } from "@/lib/env";
import { MemoryCounterStore, SpendGuard } from "@/lib/meta/spend";
import { rebuild, TOOLS } from "@/lib/rebuild/agent";
import { RebuildRequest, RebuildResponse } from "@/lib/rebuild/contract";
import { checkReason, checkResponse, Draft, fallback } from "@/lib/rebuild/draft";
import { REBUILD_CASES } from "../../evals/rebuild/cases";

const env = readEnv({ META_API_KEY: "test-key" });
const req = (name: string) => RebuildRequest.parse(REBUILD_CASES.find((c) => c.name === name)!.request);

describe("contract", () => {
  it("every eval case is a valid request", () => {
    for (const c of REBUILD_CASES) expect(RebuildRequest.safeParse(c.request).success).toBe(true);
  });

  it("refuses a missed id that isn't in items, and a session for an unknown deadline", () => {
    const r = req("simple-move");
    expect(RebuildRequest.safeParse({ ...r, missed: { item_id: "nope", reply: null } }).success).toBe(false);
    const items = r.items.map((i) => (i.id === "s_outline" ? { ...i, for: "d_nope" } : i));
    expect(RebuildRequest.safeParse({ ...r, items }).success).toBe(false);
  });

  it("the tool schemas are closed, with every property required", () => {
    for (const t of TOOLS) {
      expect(t.parameters.additionalProperties).toBe(false);
      expect(t.parameters.required).toEqual(Object.keys(t.parameters.properties as object));
    }
  });
});

describe("free time", () => {
  it("is open windows minus busy time and planned items, from now, in 5-minute steps", () => {
    const d = new Draft({ ...req("simple-move"), now: "2026-11-04T19:07:00-05:00" });
    const free = d.free().map((x) => d.at(x));
    expect(free[0]).toBe("Wed Nov 4 19:10-22:00");
    // Thu 13:00-14:00 is free; the essay outline sits at 14:00-15:00.
    expect(free).toContain("Thu Nov 5 13:00-14:00");
    expect(free.some((f) => f.includes("14:00-15:00"))).toBe(false);
  });

  it("an item moved away frees its slot for others", () => {
    const d = new Draft(req("make-room"));
    expect(d.free("s_calc").some((x) => d.at(x) === "Wed Nov 4 21:00-22:00")).toBe(false);
    expect(d.move("s_laundry", "2026-11-05T17:00", null, "it has no deadline, so it made room").ok).toBe(true);
    expect(d.free("s_calc").some((x) => d.at(x) === "Wed Nov 4 21:00-22:00")).toBe(true);
    expect(d.move("s_calc", "2026-11-04T21:00", null, "the quiz is tomorrow morning").ok).toBe(true);
    // Laundry can't go back: calc practice is there now.
    expect(d.undo("s_laundry").ok).toBe(false);
  });
});

describe("moves", () => {
  const d = () => new Draft(req("simple-move"));
  const problem = (o: { ok: boolean; problem?: string }) => (o.ok ? null : o.problem);

  it("refuses the past, after the deadline, busy time, and lengths outside the item's", () => {
    expect(problem(d().move("s_calc", "2026-11-04T17:00", null, "ok reason"))).toMatch(/past/);
    expect(problem(d().move("s_calc", "2026-11-05T13:00", null, "ok reason"))).toMatch(/finish by Thu Nov 5 10:00 \(Quiz 3\)/); // prettier-ignore
    expect(problem(d().move("s_calc", "2026-11-05T09:00", null, "ok reason"))).toMatch(/isn't free. Free that day: 07:30-09:30/); // prettier-ignore
    expect(problem(d().move("s_calc", "2026-11-04T19:00", 90, "ok reason"))).toMatch(/longer/);
    expect(problem(d().move("s_calc", "2026-11-04T19:00", 20, "ok reason"))).toMatch(/shortest version is 30/);
    expect(problem(d().move("s_calc", "2026-11-04T19:03", null, "ok reason"))).toMatch(/5-minute/);
    expect(problem(d().move("s_nope", "2026-11-04T19:00", null, "ok reason"))).toMatch(/no item/);
  });

  it("accepts a move that fits, and takes seconds or an offset in the time", () => {
    expect(d().move("s_calc", "2026-11-04T19:00", null, "the quiz is tomorrow").ok).toBe(true);
    expect(d().move("s_calc", "2026-11-04T19:00:00", 45, "the quiz is tomorrow").ok).toBe(true);
    expect(d().move("s_calc", "2026-11-05T00:00:00Z", null, "the quiz is tomorrow").ok).toBe(true); // 19:00 in New York
  });

  it("refuses a wall-clock time that doesn't exist when clocks spring forward", () => {
    const r = req("simple-move");
    const spring = new Draft({ ...r, now: "2026-03-07T20:00:00-05:00" });
    expect(spring.parseLocal("2026-03-08T02:30")).toMatch(/doesn't exist/);
    expect(typeof spring.parseLocal("2026-03-08T03:30")).toBe("number");
  });

  it("reasons stay calm, plain, and free of clock times", () => {
    expect(checkReason("because it's the last free hour before the quiz.")).toEqual({ ok: true, reason: "it's the last free hour before the quiz" }); // prettier-ignore
    for (const bad of [
      "you missed it again",
      "don't break your streak",
      "you've got this!",
      "it's free at 7pm",
      "it's open at 19:00",
    ])
      // prettier-ignore
      expect(checkReason(bad).ok).toBe(false);
  });
});

describe("message", () => {
  it("says what moved, when, and why, then that nothing else changed", () => {
    const d = new Draft(req("simple-move"));
    d.move("s_calc", "2026-11-04T19:00", null, "it's the last free evening before the quiz");
    expect(d.message()).toBe("Moved Calc practice to 7pm today because it's the last free evening before the quiz. Nothing else changed."); // prettier-ignore
  });

  it("names a shorter session, and days as tomorrow or a weekday", () => {
    const d = new Draft(req("make-room"));
    expect(d.move("s_laundry", "2026-11-05T17:30", null, "it has no deadline, so it made room for Calc practice").ok).toBe(true); // prettier-ignore
    expect(d.move("s_calc", "2026-11-04T21:00", 45, "the quiz is tomorrow morning").ok).toBe(true);
    expect(d.message()).toBe(
      "Moved Calc practice to 9pm today, 45 min instead of 60, because the quiz is tomorrow morning. Moved Laundry to 5:30pm tomorrow because it has no deadline, so it made room for Calc practice. Nothing else changed.",
    );
    expect(d.when(Date.parse("2026-11-06T17:30:00-05:00"))).toBe("Fri 5:30pm");
    expect(d.when(Date.parse("2026-11-12T09:00:00-05:00"))).toBe("Thu Nov 12, 9am");
  });

  it("across the clock change, times are in the zone's new offset", () => {
    const d = new Draft(req("dst-weekend"));
    expect(d.move("s_calc", "2026-11-01T10:00", null, "you said tonight is out").ok).toBe(true);
    const res = d.response("agent");
    expect(res.diff[0]).toMatchObject({ start: "2026-11-01T10:00:00-05:00", end: "2026-11-01T11:00:00-05:00" });
    expect(res.message).toMatch(/^Moved Calc practice to 10am tomorrow because/);
  });
});

describe("fallback", () => {
  it("takes the first free time before the deadline", () => {
    const res = fallback(req("simple-move")).response("fallback");
    expect(res.diff[0]).toMatchObject({ action: "move", start: "2026-11-04T19:00:00-05:00" });
    expect(res.diff.slice(1).every((x) => x.action === "keep")).toBe(true);
    expect(checkResponse(req("simple-move"), res)).toEqual([]);
  });

  it("shortens to fit, or drops when nothing fits before the deadline", () => {
    const short = fallback(req("shorten")).response("fallback");
    expect(short.message).toMatch(/45 min instead of 90/);
    const none = fallback(req("no-time")).response("fallback");
    expect(none.diff[0].action).toBe("drop");
    expect(none.message).toBe(
      "Dropped Calc practice because there's no open time before Quiz 3. Nothing else changed.",
    );
  });
});

describe("checkResponse", () => {
  const r = req("simple-move");
  const good = () => {
    const d = new Draft(r);
    d.move("s_calc", "2026-11-04T19:00", null, "the quiz is tomorrow");
    return d.response("agent");
  };

  it("passes a rebuild made through the Draft", () => {
    expect(checkResponse(r, good())).toEqual([]);
  });

  it("catches a move into busy time, a message that doesn't match, and a missing item", () => {
    const busy: RebuildResponse = { ...good(), diff: good().diff.map((x, n) => (n === 0 ? { ...x, start: "2026-11-05T14:00:00-05:00", end: "2026-11-05T15:00:00-05:00" } : x)) }; // prettier-ignore
    expect(checkResponse(r, busy).join()).toMatch(/after it's due|not free/);
    expect(checkResponse(r, { ...good(), message: "Moved everything. Nothing else changed." })).toEqual(["the message doesn't match the diff"]); // prettier-ignore
    expect(checkResponse(r, { ...good(), diff: good().diff.slice(1) }).join()).toMatch(/every item|missed item/);
  });
});

// The agent loop, against scripted model replies.
type Item = Record<string, unknown>;
const call = (name: string, args: unknown, id = name): Item => ({
  type: "function_call",
  id: `fc_${id}`,
  call_id: `call_${id}`,
  name,
  arguments: JSON.stringify(args),
  status: "completed",
});
const outputOf = (input: unknown, callId: string) =>
  JSON.parse((input as Item[]).find((i) => i.type === "function_call_output" && i.call_id === callId)!.output as string); // prettier-ignore
const reply = (...output: Item[]) =>
  new Response(
    JSON.stringify({
      id: "resp",
      model: "muse-spark-1.3",
      status: "completed",
      output: [{ type: "reasoning", id: "rs", encrypted_content: "x", summary: [] }, ...output],
      usage: { input_tokens: 1000, output_tokens: 50, input_tokens_details: { cached_tokens: 800 } },
    }),
  );

function scripted(...replies: (Response | Error)[]) {
  const sent: Item[] = [];
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    const next = replies.shift();
    if (!next) throw new Error("no more replies");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { sent, opts: { env, fetchImpl, guard: new SpendGuard(new MemoryCounterStore(), 1), log: () => {}, sleep: async () => {} } }; // prettier-ignore
}

describe("rebuild agent", () => {
  it("runs the tools, replays reasoning statelessly, and returns the agent's diff", async () => {
    const { sent, opts } = scripted(
      reply(call("find_open_time", { minutes: 60, after: null, before: "2026-11-05T10:00" })),
      // Spark sometimes leaves out a null field or sends a number as a string.
      reply(
        call("move_item", { item_id: "s_calc", start: "2026-11-04T19:00", reason: "the quiz is tomorrow morning" }),
      ),
      reply(call("propose_diff", {})),
    );
    const run = await rebuild(req("simple-move"), opts);
    expect(run.fellBack).toBeNull();
    expect(run.refused).toBe(0);
    expect(run.response.decided_by).toBe("agent");
    expect(run.response.message).toBe("Moved Calc practice to 7pm today because the quiz is tomorrow morning. Nothing else changed."); // prettier-ignore
    const last = sent.at(-1)!;
    expect(last).toMatchObject({ store: false, include: ["reasoning.encrypted_content"], prompt_cache_key: "rebuild" });
    const input = last.input as Item[];
    expect(input.filter((i) => i.type === "reasoning")).toHaveLength(2);
    expect(input.filter((i) => i.type === "function_call_output").map((i) => i.call_id)).toEqual(["call_find_open_time", "call_move_item"]); // prettier-ignore
  });

  it("tells the model why a move was refused, and lets it try again", async () => {
    const { sent, opts } = scripted(
      reply(call("move_item", { item_id: "s_calc", start: "2026-11-05T13:00", duration_min: null, reason: "later is fine" }, "a")), // prettier-ignore
      reply(call("move_item", { item_id: "s_calc", start: "2026-11-05T07:30", duration_min: null, reason: "the quiz is at ten" }, "b")), // prettier-ignore
      reply(call("propose_diff", {})),
    );
    const run = await rebuild(req("simple-move"), opts);
    expect(run.refused).toBe(1);
    expect(run.response.diff[0].start).toBe("2026-11-05T07:30:00-05:00");
    expect(outputOf(sent[1].input, "call_a").problem).toMatch(/finish by/);
  });

  it("pushes back once on a drop while time still fits, then accepts it", async () => {
    const { sent, opts } = scripted(
      reply(call("drop_item", { item_id: "s_calc", reason: "there's no time" }), call("propose_diff", {}, "p1")),
      reply(call("propose_diff", {}, "p2")),
    );
    const run = await rebuild(req("simple-move"), opts);
    expect(outputOf(sent[1].input, "call_p1").problem).toMatch(/still fits/);
    expect(run.response.diff[0].action).toBe("drop");
    expect(run.response.decided_by).toBe("agent");
  });

  it("falls back to code when the model can't be reached", async () => {
    const { opts } = scripted(new TypeError("fetch failed"), new TypeError("fetch failed"));
    const run = await rebuild(req("simple-move"), opts);
    expect(run.fellBack).toBe("TypeError");
    expect(run.response.decided_by).toBe("fallback");
    expect(checkResponse(req("simple-move"), run.response)).toEqual([]);
  });

  it("falls back after too many turns", async () => {
    const { opts } = scripted(...Array.from({ length: 3 }, () => reply(call("get_day", { date: "2026-11-05" }))));
    const run = await rebuild(req("simple-move"), { ...opts, maxTurns: 3 });
    expect(run.fellBack).toBe("TooManyTurns");
  });
});

describe("POST /api/rebuild", () => {
  const SECRET = "s".repeat(40);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const post = async (body: unknown, auth: string | null = `Bearer ${SECRET}`) => {
    const { POST } = await import("@/app/api/rebuild/route");
    return POST(
      new Request("http://lens.test/api/rebuild", {
        method: "POST",
        headers: auth ? { Authorization: auth } : {},
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  };

  it("is closed without the secret configured, or with the wrong one", async () => {
    vi.stubEnv("LENS_REBUILD_SECRET", "");
    expect((await post(req("simple-move"))).status).toBe(503);
    vi.stubEnv("LENS_REBUILD_SECRET", SECRET);
    expect((await post(req("simple-move"), "Bearer wrong")).status).toBe(401);
    expect((await post(req("simple-move"), null)).status).toBe(401);
  });

  it("says what's wrong with a request that doesn't match the contract", async () => {
    vi.stubEnv("LENS_REBUILD_SECRET", SECRET);
    expect((await post("{not json")).status).toBe(400);
    const res = await post({ ...req("simple-move"), version: 2 });
    expect(res.status).toBe(422);
    expect((await res.json()).issues).toMatch(/version/);
  });

  it("answers with the agent's rebuild, and the same request again from the cache", async () => {
    vi.stubEnv("LENS_REBUILD_SECRET", SECRET);
    vi.stubEnv("META_API_KEY", "test-key");
    const { opts } = scripted(
      reply(call("move_item", { item_id: "s_calc", start: "2026-11-04T19:00", duration_min: null, reason: "the quiz is tomorrow morning" })), // prettier-ignore
      reply(call("propose_diff", {})),
    );
    vi.stubGlobal("fetch", opts.fetchImpl);
    const body = { ...req("simple-move"), now: "2026-11-04T18:11:00-05:00" };
    const first = await post(body);
    expect(first.status).toBe(200);
    const json = RebuildResponse.parse(await first.json());
    expect(json.decided_by).toBe("agent");
    // No replies are left in the script: a second model call would fail and fall back.
    expect(await (await post(body)).json()).toEqual(json);
  });
});

describe("POST /api/rebuild/demo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const post = async (body: unknown, ip = "203.0.113.7") => {
    const { POST } = await import("@/app/api/rebuild/demo/route");
    return POST(
      new Request("http://lens.test/api/rebuild/demo", {
        method: "POST",
        headers: { "x-real-ip": ip },
        body: JSON.stringify(body),
      }),
    );
  };

  it("refuses an unknown case", async () => {
    expect((await post({ case: "nope", reply: null })).status).toBe(404);
  });

  it("runs the recorded case's week with the visitor's reply, and caches it", async () => {
    vi.stubEnv("META_API_KEY", "test-key");
    const { sent, opts } = scripted(
      reply(call("move_item", { item_id: "s_calc", start: "2026-11-05T07:30", duration_min: null, reason: "you said tonight is out" })), // prettier-ignore
      reply(call("propose_diff", {})),
    );
    vi.stubGlobal("fetch", opts.fetchImpl);
    const body = { case: "tired-tonight", reply: "  band practice until 10 tonight " };
    const first = await post(body, "203.0.113.8");
    expect(first.status).toBe(200);
    const json = await first.json();
    expect(json).toMatchObject({ cached: false, fell_back: null, turns: 2 });
    expect(json.response.message).toMatch(/^Moved Calc practice to 7:30am tomorrow because you said tonight is out/);
    expect(JSON.stringify(sent[0].input)).toContain("band practice until 10 tonight");
    expect(await (await post(body, "203.0.113.8")).json()).toMatchObject({ cached: true });
  });

  it("limits live runs per visitor", async () => {
    vi.stubEnv("META_API_KEY", "test-key");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const statuses = [];
    for (let n = 0; n < 7; n++) statuses.push((await post({ case: "partial", reply: `try ${n}` }, "203.0.113.9")).status); // prettier-ignore
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(statuses[6]).toBe(429);
  });
});
