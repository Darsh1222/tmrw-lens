import { createHash, timingSafeEqual } from "node:crypto";

// Tomorrow calls Lens server to server (/api/rebuild, /api/extract) with one
// shared secret, LENS_REBUILD_SECRET, as a Bearer token. Compared as hashes in
// constant time, so neither the length nor the content leaks through timing.

const digest = (s: string) => createHash("sha256").update(s).digest();

export function fromTomorrow(header: string | null, secret: string): boolean {
  const token = header?.match(/^Bearer (.+)$/)?.[1];
  return !!token && timingSafeEqual(digest(token), digest(secret));
}
