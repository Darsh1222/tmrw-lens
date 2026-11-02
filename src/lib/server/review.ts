import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Kv } from "@/lib/server/kv";

// Review links for text-a-photo: https://lens.bettertmrw.app/review/<token>,
// valid for 24 hours. What was read is stored encrypted with a random key that
// exists only inside the link, so Lens's storage alone can't open it; the link
// is signed with Lens's secret, so it can't be forged or have its expiry
// changed. The photos themselves are never stored, only what was read from them.

const TTL_S = 24 * 3600;
const ID = 16;
const KEY = 32;
const MAC = 16;

const b64u = (b: Buffer) => b.toString("base64url");
const sha = (...parts: (string | Buffer)[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

export type ReviewLink = { token: string; expires_at: string };

export function reviewStore(kv: Kv, secret: string) {
  const signKey = sha("lens-review-sign", secret);
  const mac = (body: Buffer) => createHmac("sha256", signKey).update(body).digest().subarray(0, MAC);
  const slot = (id: Buffer) => `lens:review:${sha("lens-review-id", id).toString("hex")}`;

  function open(token: string): { id: Buffer; key: Buffer; exp: number } | null {
    const [body64, mac64] = token.split(".");
    if (!body64 || !mac64) return null;
    const body = Buffer.from(body64, "base64url");
    const given = Buffer.from(mac64, "base64url");
    if (body.length !== ID + KEY + 4 || given.length !== MAC || !timingSafeEqual(given, mac(body))) return null;
    const exp = body.readUInt32BE(ID + KEY);
    if (exp * 1000 < Date.now()) return null;
    return { id: body.subarray(0, ID), key: body.subarray(ID, ID + KEY), exp };
  }

  async function write(id: Buffer, key: Buffer, exp: number, value: unknown) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
    const ttl = Math.max(1, exp - Math.floor(Date.now() / 1000));
    await kv.set(slot(id), Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64"), ttl);
  }

  return {
    async create(value: unknown, now = Date.now()): Promise<ReviewLink> {
      const id = randomBytes(ID);
      const key = randomBytes(KEY);
      const exp = Math.floor(now / 1000) + TTL_S;
      const body = Buffer.concat([id, key, Buffer.alloc(4)]);
      body.writeUInt32BE(exp, ID + KEY);
      await write(id, key, exp, value);
      return { token: `${b64u(body)}.${b64u(mac(body))}`, expires_at: new Date(exp * 1000).toISOString() };
    },
    /** What the link holds, or null if it's forged, expired, or gone. */
    async load<T>(token: string): Promise<{ value: T; expires_at: string } | null> {
      const t = open(token);
      if (!t) return null;
      const stored = await kv.get(slot(t.id));
      if (!stored) return null;
      try {
        const buf = Buffer.from(stored, "base64");
        const d = createDecipheriv("aes-256-gcm", t.key, buf.subarray(0, 12));
        d.setAuthTag(buf.subarray(12, 28));
        const value = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8")) as T;
        return { value, expires_at: new Date(t.exp * 1000).toISOString() };
      } catch {
        return null;
      }
    },
    /** Replaces what the link holds (after answers), keeping its expiry. */
    async save(token: string, value: unknown): Promise<boolean> {
      const t = open(token);
      if (!t) return false;
      await write(t.id, t.key, t.exp, value);
      return true;
    },
  };
}
