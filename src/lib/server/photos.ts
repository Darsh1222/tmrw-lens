import type { Env } from "@/lib/env";
import { dataUrl } from "@/lib/extract/read";
import { KIND_LABEL } from "@/lib/extract/kinds";
import { classifyTask, type PhotoClass } from "@/lib/extract/tasks";
import { preparePhoto } from "@/lib/images/prepare";
import type { CallResult } from "@/lib/meta/client";
import { runTask } from "@/lib/meta/task";
import type { SourceKind } from "@/lib/schemas/evidence";
import type { SourceReading } from "@/lib/plan/types";
import { contentCache, type Kv } from "@/lib/server/kv";
import { readCached } from "@/lib/server/read";
import type { PhotoInfo } from "@/lib/tomorrow/extract";

// Texted photos, read: each is made upright and shrunk (keeping only its
// capture time), classified with one cheap call (what it is, and whether it can
// be read at all), then read like any page in the app. A photo that can't be
// read isn't guessed at: it's skipped, and the response asks for a better one.
// Classification and reading are both cached by the photo's bytes; the photos
// themselves are never stored.

/** What the bytes are, from their first bytes: only JPEG and PNG are read; HEIC is named so Tomorrow can convert it. */
export function imageType(b: Uint8Array): "jpeg" | "png" | "heic" | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (String.fromCharCode(...b.subarray(4, 12)).match(/^ftyp(heic|heix|mif1|msf1)/)) return "heic";
  return null;
}

const PHOTO_KINDS: SourceKind[] = ["whiteboard_photo", "notes_photo"];

export function kindOf(c: PhotoClass): SourceKind | null {
  if (c.kind === "other" || c.readable === "no") return null;
  return c.kind === "syllabus_page" ? "syllabus_pdf" : c.kind;
}

export async function readPhotos(
  images: Uint8Array[],
  { env, kv, now, onMiss }: { env: Env; kv: Kv; now: string; onMiss?: () => Promise<void> },
): Promise<{ readings: SourceReading[]; photos: PhotoInfo[]; calls: CallResult[] }> {
  const classified = contentCache(kv, `classify|${classifyTask.version}|${env.MUSE_SPARK_MODEL}`);
  const done = await Promise.all(
    images.map(async (bytes, index) => {
      const calls: CallResult[] = [];
      const photo = await preparePhoto(bytes);
      let cls = await classified.get<PhotoClass>(photo.bytes).catch(() => null);
      if (!cls) {
        await onMiss?.();
        const r = await runTask(classifyTask, [{ type: "input_image", image_url: dataUrl(photo.bytes, photo.mime) }], { env }); // prettier-ignore
        calls.push(...r.calls);
        cls = r.data;
        await classified.set(photo.bytes, cls).catch(() => {});
      }
      const kind = kindOf(cls);
      const info: PhotoInfo = { index, kind: kind ?? "other", readable: cls.readable, items: 0 };
      if (!kind) return { info, reading: null, calls };
      const read = await readCached(
        { kind, page: kind === "syllabus_pdf" ? 1 : null, image: photo.bytes, mime: photo.mime, text: null },
        { env, kv, onMiss },
      );
      calls.push(...read.calls);
      const reading: SourceReading = {
        source: {
          id: `photo${index + 1}`,
          kind,
          label: kind === "syllabus_pdf" ? "syllabus photo" : KIND_LABEL[kind],
          captured_at: PHOTO_KINDS.includes(kind) ? photo.takenAt : null,
          added_at: now,
        },
        pages: [read.page],
      };
      return { info, reading, calls };
    }),
  );
  return {
    readings: done.flatMap((d) => (d.reading ? [d.reading] : [])),
    photos: done.map((d) => d.info),
    calls: done.flatMap((d) => d.calls),
  };
}
