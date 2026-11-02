import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readEnv } from "@/lib/env";
import type { PageReading } from "@/lib/plan/types";
import { kvFor } from "@/lib/server/kv";
import { reviewStore } from "@/lib/server/review";
import { assemble, ExtractResponse, type ExtractState, type PhotoInfo } from "@/lib/tomorrow/extract";
import { EXTRACT_CASES } from "../../evals/extract/cases";

const SECRET = "x".repeat(40);
const kv = () => kvFor(readEnv({}));
const REVIEW = { url: "https://lens.example/review/t", expires_at: "2026-11-02T00:00:00.000Z" };

// The recorded reading of the synthetic "quiz moved" whiteboard, as the extract eval replays it.
function quizMoved(answers: ExtractState["answers"] = []): ExtractState {
  const c = EXTRACT_CASES.find((x) => x.name === "whiteboard-moves-quiz")!;
  const rec = JSON.parse(readFileSync(new URL("../../evals/extract/recorded/whiteboard-quiz-moved.jpg.json", import.meta.url), "utf8")) as { photo: PhotoInfo; page: PageReading; taken_at: string | null }; // prettier-ignore
  return {
    version: 1,
    zone: "America/New_York",
    now: c.now,
    readings: [{ source: { id: "photo1", kind: "whiteboard_photo", label: "whiteboard photo", captured_at: rec.taken_at, added_at: c.now }, pages: [rec.page] }], // prettier-ignore
    photos: [{ ...rec.photo, index: 0 }],
    existing: c.existing,
    term: c.term,
    answers,
  };
}

describe("review links", () => {
  it("round-trip what they hold, and can be saved over", async () => {
    const store = reviewStore(kv(), SECRET);
    const link = await store.create({ hello: "world" });
    expect((await store.load<{ hello: string }>(link.token))?.value).toEqual({ hello: "world" });
    expect(await store.save(link.token, { hello: "again" })).toBe(true);
    expect((await store.load<{ hello: string }>(link.token))?.value).toEqual({ hello: "again" });
  });

  it("refuse a forged, altered, or expired link, and one signed with another secret", async () => {
    const store = reviewStore(kv(), SECRET);
    const link = await store.create({ a: 1 });
    const [body, mac] = link.token.split(".");
    const flipped = body.slice(0, -2) + (body.at(-2) === "A" ? "B" : "A") + body.at(-1);
    expect(await store.load(`${flipped}.${mac}`)).toBeNull();
    expect(await store.load(`${body}.AAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
    expect(await store.load("nonsense")).toBeNull();
    expect(await reviewStore(kv(), "y".repeat(40)).load(link.token)).toBeNull();
    const old = await store.create({ a: 1 }, Date.now() - 25 * 3600_000);
    expect(await store.load(old.token)).toBeNull();
  });
});

describe("assemble", () => {
  it("asks for the photo's date first, and changes nothing before it's answered", () => {
    const r = ExtractResponse.parse(assemble(quizMoved(), REVIEW));
    expect(r.questions[0].id).toBe("q_photo_date_photo1");
    expect(r.questions[0]).toMatchObject({ suggested: "today" });
    expect(r.changes).toEqual([]);
    expect(r.duplicates.map((d) => d.existing_id)).toEqual(["t_ps6"]);
  });

  it("then shows the move as a change with its question, never applied until answered", () => {
    const today = { question_id: "q_photo_date_photo1", option_id: "today" };
    const r = assemble(quizMoved([today]), REVIEW);
    expect(r.changes).toMatchObject([{ existing_id: "t_quiz3", to: { date: "2026-11-02" }, kind: "moved", status: "needs_question", auto_apply: false }]); // prettier-ignore
    expect(r.questions.map((q) => q.id)).toEqual(["q_change_t_quiz3"]);
    expect(r.items.some((i) => i.title.toLowerCase().includes("quiz"))).toBe(false);

    const yes = assemble(quizMoved([today, { question_id: "q_change_t_quiz3", option_id: "new" }]), REVIEW);
    expect(yes.changes[0]).toMatchObject({ status: "confirmed", auto_apply: true });
    expect(yes.questions).toEqual([]);

    const keep = assemble(quizMoved([today, { question_id: "q_change_t_quiz3", option_id: "keep" }]), REVIEW);
    expect(keep.changes[0]).toMatchObject({ status: "kept", auto_apply: false });

    const apart = assemble(quizMoved([today, { question_id: "q_change_t_quiz3", option_id: "different" }]), REVIEW);
    expect(apart.changes).toEqual([]);
    expect(apart.items.find((i) => i.kind !== "class_block" && i.date === "2026-11-02")?.auto_apply).toBe(true);
  });
});

describe("POST /api/extract", () => {
  afterEach(() => vi.unstubAllEnvs());
  const post = async (body: unknown, auth: string | null = `Bearer ${SECRET}`) => {
    const { POST } = await import("@/app/api/extract/route");
    return POST(
      new Request("http://lens.test/api/extract", {
        method: "POST",
        headers: auth ? { Authorization: auth } : {},
        body: JSON.stringify(body),
      }),
    );
  };
  const body = (data: string) => ({
    version: 1,
    user_ref: "user_0001",
    zone: "America/New_York",
    now: "2026-11-01T18:00:00-05:00",
    images: [{ data }],
    existing: [],
    term: null,
  });

  it("is closed without the secret, or with the wrong one", async () => {
    vi.stubEnv("LENS_REBUILD_SECRET", "");
    expect((await post(body("aGVsbG8gd29ybGQgaGVsbG8="))).status).toBe(503);
    vi.stubEnv("LENS_REBUILD_SECRET", SECRET);
    expect((await post(body("aGVsbG8gd29ybGQgaGVsbG8="), "Bearer nope")).status).toBe(401);
  });

  it("says what's wrong with the request, and refuses HEIC, non-images, and big images", async () => {
    vi.stubEnv("LENS_REBUILD_SECRET", SECRET);
    const bad = await post({ ...body("aGVsbG8gd29ybGQgaGVsbG8="), images: [] });
    expect(bad.status).toBe(422);
    expect((await bad.json()).issues).toMatch(/images/);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
    expect((await post(body(heic.toString("base64")))).status).toBe(415);
    expect((await post(body(Buffer.from("not an image at all").toString("base64")))).status).toBe(415);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(3_000_001)]);
    expect((await post(body(big.toString("base64")))).status).toBe(413);
  });

  it("accepts a request without user_ref (Tomorrow before it sends one): never a 422 for that", async () => {
    vi.stubEnv("LENS_REBUILD_SECRET", SECRET);
    const anonymous: Record<string, unknown> = body(Buffer.from("not an image at all").toString("base64"));
    delete anonymous.user_ref;
    // Past the contract check, to the image check: the missing user_ref isn't what's wrong.
    expect((await post(anonymous)).status).toBe(415);
  });
});

describe("POST /api/extract/answer", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("replays answers onto the stored reading, with no model call", async () => {
    vi.stubEnv("LENS_REBUILD_SECRET", SECRET);
    const link = await reviewStore(kv(), SECRET).create(quizMoved());
    const { POST } = await import("@/app/api/extract/answer/route");
    const answer = (answers: unknown[]) =>
      POST(new Request("http://lens.test/api/extract/answer", { method: "POST", headers: { Authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ version: 1, review: link.token, answers }) })); // prettier-ignore
    const first = ExtractResponse.parse(await (await answer([{ question_id: "q_photo_date_photo1", option_id: "today", value: null }])).json()); // prettier-ignore
    expect(first.questions.map((q) => q.id)).toEqual(["q_change_t_quiz3"]);
    // Answers accumulate in the link: the next text only carries the next answer.
    const second = ExtractResponse.parse(await (await answer([{ question_id: "q_change_t_quiz3", option_id: "new", value: null }])).json()); // prettier-ignore
    expect(second.changes[0]).toMatchObject({ status: "confirmed", auto_apply: true });
    expect((await answer([])).status).toBe(422);
  });
});
