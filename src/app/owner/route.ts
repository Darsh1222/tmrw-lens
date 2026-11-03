import { readEnv } from "@/lib/env";
import { isOwnerKey, ownerCookie } from "@/lib/server/identity";

// The owner's way past the per-visitor limits: /owner?key=<OWNER_KEY> sets a
// signed, httpOnly cookie and goes home, so the key leaves the address bar at
// once. A wrong key, or no OWNER_KEY on this deployment, is a plain 404: the
// route doesn't say it exists.

export async function GET(request: Request): Promise<Response> {
  const env = readEnv();
  const key = new URL(request.url).searchParams.get("key");
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (!isOwnerKey(env, key)) return new Response("Not found", { status: 404, headers });
  console.info(JSON.stringify({ event: "owner_cookie_set" }));
  return new Response(null, { status: 303, headers: { ...headers, Location: "/", "Set-Cookie": ownerCookie(env) } });
}
