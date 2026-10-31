import { createHash } from "node:crypto";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { ImportRequest, ImportResponse } from "@/lib/tomorrow/contract";

// Send to Tomorrow. The page builds the import (only verified items, after the
// date audit) and this relays it to Tomorrow's /api/lens/import with the
// person's Lens token from Tomorrow's Settings. The token is passed through,
// never stored or logged. The Idempotency-Key is a hash of the items, so
// pressing Send twice creates nothing twice.

export const maxDuration = 30;

const Body = z.object({ token: z.string().min(8).max(400), import: ImportRequest });

export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That isn't a plan Lens can send." }, { status: 400 });
  const { token, import: payload } = parsed.data;
  const env = readEnv();
  const key = createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  let res: Response;
  try {
    res = await fetch(env.TOMORROW_IMPORT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return Response.json({ error: "Couldn't reach Tomorrow. Try again in a minute." }, { status: 502 });
  }
  if (res.status === 401 || res.status === 403)
    return Response.json({ error: "Tomorrow didn't accept that token. Copy a new one from Tomorrow's Settings." }, { status: 401 }); // prettier-ignore
  if (res.status === 404)
    return Response.json({ error: "Tomorrow isn't ready for Lens imports yet." }, { status: 502 });
  if (!res.ok) return Response.json({ error: `Tomorrow refused the import (${res.status}).` }, { status: 502 });
  const body = ImportResponse.safeParse(await res.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Tomorrow's reply wasn't what Lens expects." }, { status: 502 });
  return Response.json(body.data);
}
