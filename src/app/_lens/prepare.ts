"use client";

import { readExif } from "@/lib/images/exif";
import type { SourceKind } from "@/lib/schemas/evidence";

// Getting inputs ready in the browser, before anything leaves the device:
// photos are turned upright, shrunk to at most 2048px, and re-encoded as JPEG
// (which drops EXIF, location included; the capture time is read first, since
// "Mon" on a whiteboard means the Monday after it was taken). PDF pages are
// rendered to images here, with their text layer, so each request is one small
// page and the server never sees the file.

const MAX_EDGE = 2048;
export const MAX_PDF_PAGES = 12;

export type PreparedPage = {
  page: number | null;
  blob: Blob | null;
  url: string | null;
  width: number;
  height: number;
  text: string | null;
};

export type Prepared = {
  kind: SourceKind;
  label: string;
  takenAt: string | null;
  pages: PreparedPage[];
  note: string | null;
};

function canvasBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't encode the image"))), type, quality),
  );
}

export function guessKind(name: string, type: string): SourceKind {
  const n = name.toLowerCase();
  if (type === "application/pdf" || n.endsWith(".pdf")) return "syllabus_pdf";
  if (type.startsWith("text/") || n.endsWith(".txt")) return "testudo_text";
  if (/testudo|schedule|screen ?shot/.test(n)) return "testudo_screenshot";
  if (/board/.test(n)) return "whiteboard_photo";
  return "notes_photo";
}

export const KIND_LABEL: Record<SourceKind, string> = {
  testudo_screenshot: "Testudo schedule",
  testudo_text: "pasted Testudo schedule",
  syllabus_pdf: "syllabus",
  whiteboard_photo: "whiteboard photo",
  notes_photo: "notes photo",
};

async function prepareImage(file: Blob): Promise<{ page: PreparedPage; takenAt: string | null }> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const { takenAt } = readExif(head);
  let bitmap: ImageBitmap;
  try {
    // Browsers apply the EXIF orientation here.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      "This browser can't open that photo. Try a JPEG or PNG (on iPhone, Settings > Camera > Most Compatible).",
    );
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const blob = await canvasBlob(c, "image/jpeg", 0.9);
  return {
    page: { page: null, blob, url: URL.createObjectURL(blob), width: c.width, height: c.height, text: null },
    takenAt,
  };
}

async function renderPdf(file: Blob): Promise<{ pages: PreparedPage[]; total: number }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), standardFontDataUrl: "/pdfjs/standard_fonts/" }); // prettier-ignore
  const doc = await task.promise;
  const pages: PreparedPage[] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      const c = document.createElement("canvas");
      c.width = Math.ceil(viewport.width);
      c.height = Math.ceil(viewport.height);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvas: c, canvasContext: ctx, viewport }).promise;
      // The same text layer as scripts/lib/render-pdf.ts, so quotes check the same way they do in evals.
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : ""))
        .join("")
        .trim();
      let blob = await canvasBlob(c, "image/png");
      // A scanned page can be a big PNG; a JPEG keeps every request small.
      if (blob.size > 3_000_000) blob = await canvasBlob(c, "image/jpeg", 0.9);
      pages.push({
        page: n,
        blob,
        url: URL.createObjectURL(blob),
        width: c.width,
        height: c.height,
        text: text || null,
      });
    }
  } finally {
    await task.destroy();
  }
  return { pages, total: doc.numPages };
}

export async function prepare(file: File | Blob, name: string, kind?: SourceKind): Promise<Prepared> {
  const k = kind ?? guessKind(name, file.type);
  if (k === "testudo_text") {
    const text = (await file.text()).slice(0, 40_000);
    return { kind: k, label: KIND_LABEL[k], takenAt: null, pages: [{ page: null, blob: null, url: null, width: 0, height: 0, text }], note: null }; // prettier-ignore
  }
  if (k === "syllabus_pdf") {
    const { pages, total } = await renderPdf(file);
    const note = total > pages.length ? `Only the first ${pages.length} of ${total} pages are read.` : null;
    return { kind: k, label: KIND_LABEL[k], takenAt: null, pages, note };
  }
  const { page, takenAt } = await prepareImage(file);
  return { kind: k, label: KIND_LABEL[k], takenAt, pages: [page], note: null };
}
