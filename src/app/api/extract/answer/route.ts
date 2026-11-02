import { z } from "zod";
import { readEnv } from "@/lib/env";
import { fromTomorrow } from "@/lib/server/auth";
import { kvFor } from "@/lib/server/kv";
import { reviewStore } from "@/lib/server/review";
import { assemble, ExtractAnswerRequest, ExtractResponse, type ExtractState } from "@/lib/tomorrow/extract";

// The person's answers to text-a-photo questions (by text, relayed by
// Tomorrow): replayed onto what was read, with no model call. Returns the whole
// response again, so Tomorrow applies what's now auto-applicable and asks the
// next question. A later answer to the same question replaces the earlier one.

export async function POST(request: Request): Promise<Response> {
  const env = readEnv();
  if (!env.LENS_REBUILD_SECRET) return Response.json({ error: "Extract isn't set up on this deployment." }, { status: 503 }); // prettier-ignore
  if (!fromTomorrow(request.headers.get("authorization"), env.LENS_REBUILD_SECRET))
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  const parsed = ExtractAnswerRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "The request doesn't match the contract.", issues: z.prettifyError(parsed.error) }, { status: 422 }); // prettier-ignore
  const { review, answers } = parsed.data;

  const store = reviewStore(kvFor(env), env.LENS_REBUILD_SECRET);
  const loaded = await store.load<ExtractState>(review);
  if (!loaded) return Response.json({ error: "That review has expired or doesn't exist." }, { status: 404 });
  const ids = new Set(answers.map((a) => a.question_id));
  const state: ExtractState = {
    ...loaded.value,
    answers: [...loaded.value.answers.filter((a) => !ids.has(a.question_id)), ...answers.map((a) => ({ ...a, value: a.value ?? undefined }))], // prettier-ignore
  };
  await store.save(review, state);
  return Response.json(
    ExtractResponse.parse(
      assemble(state, { url: `${env.LENS_PUBLIC_URL}/review/${review}`, expires_at: loaded.expires_at }),
    ),
  );
}
