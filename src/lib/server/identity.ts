import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Env } from "@/lib/env";
import type { Account, Payer } from "@/lib/meta/spend";

// Who a metered request is charged to (src/lib/meta/spend.ts), hashed before it
// is counted or logged:
// - A Tomorrow user: Tomorrow's opaque `user_ref`, on a request already
//   authenticated with LENS_REBUILD_SECRET. A request without one (Tomorrow
//   before it sends it) is the shared "tomorrow-unknown" identity: counted and
//   logged, limited only by Tomorrow's global brake, since a one-person limit on
//   everyone together would stop all of Tomorrow at 30 calls.
// - A public visitor: a random id in a signed cookie, and their address. A
//   request without a valid cookie is that address's visitor (so a script that
//   never keeps the cookie gets one visitor's allowance), and is given a cookie
//   for next time. One address can still collect many cookies, so the address
//   has its own, larger allowance: room for a few people on one network, not
//   for unlimited fresh cookies.
// - The owner: a cookie signed with OWNER_KEY, set by visiting /owner?key=…
//   No per-visitor or per-address limit; still under the public pool's brake,
//   and logged as "owner".
// Hashes are keyed with LENS_REBUILD_SECRET, so a hashed address can't be
// reversed by trying every address.

/** Per identity per UTC day. Cached answers are free and never count. */
export const LIMITS = {
  tomorrowUser: { calls: 30, usd: 0.5 },
  visitor: { calls: 25, usd: 0.4 },
  address: { calls: 75, usd: 1.5 },
} as const;

export const VISITOR_COOKIE = "lens_v";
export const OWNER_COOKIE = "lens_owner";
const COOKIE_DAYS = 30;

const secretOf = (env: Env) => env.LENS_REBUILD_SECRET ?? "lens-unsigned-local-development";
const hash = (env: Env, ...parts: string[]) =>
  createHmac("sha256", secretOf(env)).update(parts.join("|")).digest("hex").slice(0, 24);
const sign = (env: Env, id: string) => hash(env, "cookie", id);

export const TOMORROW_UNKNOWN = "tomorrow-unknown";

export function tomorrowPayer(env: Env, userRef: string | null | undefined): Payer {
  if (!userRef) return { pool: "tomorrow", accounts: [{ key: TOMORROW_UNKNOWN, calls: Infinity, usd: Infinity }] };
  return { pool: "tomorrow", accounts: [{ key: `u${hash(env, "tomorrow", userRef)}`, ...LIMITS.tomorrowUser }] };
}

function cookieId(env: Env, header: string | null): string | null {
  const raw = header?.match(new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([A-Za-z0-9_-]{16,64})\\.([0-9a-f]{24})`));
  if (!raw) return null;
  const [, id, sig] = raw;
  const want = Buffer.from(sign(env, id));
  return timingSafeEqual(want, Buffer.from(sig)) ? id : null;
}

const ownerMark = (key: string) => createHmac("sha256", key).update("lens-owner-v1").digest("hex");
const sameText = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Whether `key` is the owner's key: compared as hashes, in constant time. */
export function isOwnerKey(env: Env, key: string | null): boolean {
  if (!env.OWNER_KEY || !key) return false;
  const h = (s: string) => createHmac("sha256", "lens-owner-key").update(s).digest("hex");
  return sameText(h(key), h(env.OWNER_KEY));
}

/** The cookie that marks the owner's browser: a signature only OWNER_KEY can make, never the key itself. */
export function ownerCookie(env: Env): string {
  const secure = env.VERCEL_ENV ? "; Secure" : "";
  return `${OWNER_COOKIE}=${ownerMark(env.OWNER_KEY!)}; Path=/; Max-Age=${COOKIE_DAYS * 86_400}; HttpOnly; SameSite=Lax${secure}`; // prettier-ignore
}

export function isOwner(env: Env, request: Request): boolean {
  if (!env.OWNER_KEY) return false;
  const sent = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${OWNER_COOKIE}=([0-9a-f]{64})`))?.[1];
  return !!sent && sameText(sent, ownerMark(env.OWNER_KEY));
}

/** The visitor's payer, and the cookie to set when they didn't send a valid one. */
export function visitorPayer(env: Env, request: Request): { payer: Payer; setCookie: string | null } {
  if (isOwner(env, request))
    return { payer: { pool: "public", accounts: [{ key: "owner", calls: Infinity, usd: Infinity }] }, setCookie: null };
  const address =
    request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const known = cookieId(env, request.headers.get("cookie"));
  const accounts: Account[] = [
    { key: `v${known ? hash(env, "visitor", known) : hash(env, "address-visitor", address)}`, ...LIMITS.visitor },
    { key: `a${hash(env, "address", address)}`, ...LIMITS.address },
  ];
  const secure = env.VERCEL_ENV ? "; Secure" : "";
  const fresh = randomBytes(16).toString("base64url");
  const setCookie = known
    ? null
    : `${VISITOR_COOKIE}=${fresh}.${sign(env, fresh)}; Path=/; Max-Age=${COOKIE_DAYS * 86_400}; HttpOnly; SameSite=Lax${secure}`;
  return { payer: { pool: "public", accounts }, setCookie };
}
