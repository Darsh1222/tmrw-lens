import type { Env } from "@/lib/env";
import { CROP_VERSION, GRID_VERSION, readPage, SEGMENTED_KINDS } from "@/lib/extract/read";
import { rereadTask, taskFor } from "@/lib/extract/tasks";
import type { CallResult } from "@/lib/meta/client";
import type { PageReading } from "@/lib/plan/types";
import type { SourceKind } from "@/lib/schemas/evidence";
import { contentCache, type Kv } from "@/lib/server/kv";

// One page or photo read through the content cache: the same bytes, read the
// same way (task versions, crops, models), are never paid for twice. The cache
// holds the reading, encrypted with a key derived from the bytes, for 24 hours;
// the bytes themselves are never stored.

export type ReadInput = {
  kind: SourceKind;
  page: number | null;
  image: Uint8Array | null;
  mime?: "image/jpeg" | "image/png";
  text: string | null;
};

export async function readCached(
  input: ReadInput,
  { env, kv, onMiss }: { env: Env; kv: Kv; onMiss?: () => Promise<void> },
): Promise<{ page: PageReading; cached: boolean; calls: CallResult[] }> {
  const { kind, page, image, mime, text } = input;
  const salt = [kind, taskFor(kind).version, rereadTask(1).version, CROP_VERSION, GRID_VERSION, env.MUSE_SPARK_MODEL, env.SAM_MODEL, page ?? 0].join("|"); // prettier-ignore
  const content = image ? Buffer.concat([image, Buffer.from(`\n${text ?? ""}`)]) : (text ?? "");
  const cache = contentCache(kv, salt);
  const hit = await cache.get<PageReading>(content).catch(() => null);
  if (hit) return { page: hit, cached: true, calls: [] };
  await onMiss?.();
  const { page: reading, calls } = await readPage(
    kind,
    { page, image, mime, text },
    { env, sam: SEGMENTED_KINDS.includes(kind) },
  );
  await cache.set(content, reading).catch(() => {});
  return { page: reading, cached: false, calls };
}
