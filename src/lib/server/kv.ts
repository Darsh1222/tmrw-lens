import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Env } from "@/lib/env";
import { MemoryCounterStore, UpstashCounterStore, type CounterStore } from "@/lib/meta/spend";

// Small key-value storage for the deployed app, over Upstash's REST API (plain
// fetch, as in spend.ts): per-visitor rate limits, and readings cached by the
// hash of what was read so the same photo is never paid for twice. In
// development, without Upstash, both live in memory.
//
// A cached reading holds the words on someone's photo, so it's encrypted with a
// key derived from that photo's own bytes and stored under a hash of that key:
// only someone who has the same photo can find it or read it. Nothing else
// about the visitor is kept, and it expires after 24 hours.

const DAY = 86_400;

export interface Kv extends CounterStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

class MemoryKv extends MemoryCounterStore implements Kv {
  private values = new Map<string, { value: string; until: number }>();
  async get(key: string) {
    const v = this.values.get(key);
    return v && v.until > Date.now() ? v.value : null;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.values.set(key, { value, until: Date.now() + ttlSeconds * 1000 });
  }
}

class UpstashKv extends UpstashCounterStore implements Kv {
  constructor(
    private baseUrl: string,
    private authToken: string,
  ) {
    super(baseUrl, authToken);
  }
  private async command(cmd: string[]): Promise<unknown> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.authToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: string };
    if (body.error !== undefined) throw new Error("Upstash command failed");
    return body.result ?? null;
  }
  async get(key: string) {
    const r = await this.command(["GET", key]);
    return typeof r === "string" ? r : null;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.command(["SET", key, value, "EX", String(ttlSeconds)]);
  }
}

let shared: Kv | undefined;
export function kvFor(env: Env): Kv {
  if (shared) return shared;
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN)
    shared = new UpstashKv(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  else if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview")
    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required when deployed");
  else shared = new MemoryKv();
  return shared;
}

const sha256 = (...parts: (string | Uint8Array)[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

/**
 * Cache keyed by content. `content` is the bytes (or text) that were read; `salt` says how (task versions, crops), so
 * a change to either is a miss.
 */
export function contentCache(kv: Kv, salt: string) {
  const keys = (content: Uint8Array | string) => {
    const secret = sha256("lens-cache-key", salt, content);
    return { id: `lens:read:${sha256("lens-cache-id", secret).toString("hex")}`, secret };
  };
  return {
    async get<T>(content: Uint8Array | string): Promise<T | null> {
      const { id, secret } = keys(content);
      const stored = await kv.get(id);
      if (!stored) return null;
      try {
        const buf = Buffer.from(stored, "base64");
        const d = createDecipheriv("aes-256-gcm", secret, buf.subarray(0, 12));
        d.setAuthTag(buf.subarray(12, 28));
        return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8")) as T;
      } catch {
        return null;
      }
    },
    async set(content: Uint8Array | string, value: unknown): Promise<void> {
      const { id, secret } = keys(content);
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", secret, iv);
      const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
      await kv.set(id, Buffer.concat([iv, c.getAuthTag(), body]).toString("base64"), DAY);
    },
  };
}

export class RateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many reads from here for now");
    this.name = "RateLimited";
  }
}

/** Fixed windows per visitor. The visitor is a hash of their address, never the address itself. */
export async function rateLimit(
  kv: Kv,
  visitor: string,
  limits: { perHour: number; perDay: number },
  now = new Date(),
): Promise<void> {
  const who = sha256("lens-visitor", visitor).toString("hex").slice(0, 24);
  const hour = now.toISOString().slice(0, 13);
  const day = hour.slice(0, 10);
  const [h, d] = await Promise.all([
    kv.add(`lens:rl:${who}:${hour}`, 1, 3600),
    kv.add(`lens:rl:${who}:${day}`, 1, DAY),
  ]);
  if (d > limits.perDay) throw new RateLimited(DAY - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60));
  if (h > limits.perHour) throw new RateLimited(3600 - now.getUTCMinutes() * 60);
}
