"use client";

import { KIND_LABEL } from "@/lib/extract/kinds";
import {
  csvText,
  docxText,
  htmlText,
  icsReading,
  pptxText,
  TEXT_LIMIT,
  usableText,
  xlsxText,
} from "@/lib/files/convert";
import { readExif } from "@/lib/images/exif";
import type { PageReading } from "@/lib/plan/types";
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
  /** Already read, in code (a calendar file): nothing to send. */
  readings?: PageReading[];
};

function canvasBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't encode the image"))), type, quality),
  );
}

/** What a file is, by its name: documents with their own text (read as text) and pictures (read by vision). */
export type FileType = "pdf" | "docx" | "pptx" | "xlsx" | "csv" | "html" | "ics" | "text" | "image";
export function fileType(name: string, type: string): FileType | null {
  const n = name.toLowerCase();
  if (type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".pptx")) return "pptx";
  if (n.endsWith(".xlsx")) return "xlsx";
  if (n.endsWith(".csv") || type === "text/csv") return "csv";
  if (/\.html?$/.test(n) || type === "text/html") return "html";
  if (n.endsWith(".ics") || type === "text/calendar") return "ics";
  if (n.endsWith(".txt") || type === "text/plain") return "text";
  if (type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(n)) return "image";
  if (/\.(doc|ppt|xls|pages|key|numbers|rtf|odt)$/.test(n))
    throw new Error("That's an older or non-Microsoft format. Save it as PDF or .docx, or take a screenshot.");
  return null;
}

export { usableText };

export function guessKind(name: string, type: string): SourceKind {
  const n = name.toLowerCase();
  const t = (() => {
    try {
      return fileType(name, type);
    } catch {
      return null;
    }
  })();
  if (t === "html") return "lms_screenshot";
  if (t && ["pdf", "docx", "pptx", "xlsx", "csv", "ics"].includes(t)) return "syllabus_pdf";
  if (type.startsWith("text/") || n.endsWith(".txt")) return "testudo_text";
  if (/canvas|elms|to-?do|assignments/.test(n)) return "lms_screenshot";
  if (/testudo|schedule|screen ?shot/.test(n)) return "testudo_screenshot";
  if (/board/.test(n)) return "whiteboard_photo";
  return "notes_photo";
}

export { KIND_LABEL };

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
  const doc = await task.promise.catch((e: unknown) => {
    if (e instanceof Error && e.name === "PasswordException")
      throw new Error("This PDF is password-protected. Export it without a password, or take a screenshot.");
    throw new Error("This PDF couldn't be opened. Try exporting it again, or take a screenshot.");
  });
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

const textPage = (text: string): PreparedPage => ({ page: null, blob: null, url: null, width: 0, height: 0, text: text.slice(0, TEXT_LIMIT) }); // prettier-ignore

export async function prepare(file: File | Blob, name: string, kind?: SourceKind): Promise<Prepared> {
  const k = kind ?? guessKind(name, file.type);
  const type = fileType(name, file.type);
  // Documents that hold their own words: taken out here, read once as text.
  if (type && ["docx", "pptx", "xlsx", "csv", "html", "ics"].includes(type)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (type === "ics") {
      const { reading, note } = icsReading(new TextDecoder().decode(bytes), Intl.DateTimeFormat().resolvedOptions().timeZone); // prettier-ignore
      return { kind: "syllabus_pdf", label: "calendar file", takenAt: null, pages: [textPage(reading.text ?? "")], note, readings: [reading] }; // prettier-ignore
    }
    const text =
      type === "docx" ? docxText(bytes) : type === "pptx" ? pptxText(bytes) : type === "xlsx" ? xlsxText(bytes) : type === "csv" ? csvText(new TextDecoder().decode(bytes)) : htmlText(new TextDecoder().decode(bytes)); // prettier-ignore
    if (!usableText(text)) throw new Error("There's no text in this file to read. Try a PDF or a screenshot.");
    const label = { docx: "Word document", pptx: "slides", xlsx: "spreadsheet", csv: "spreadsheet", html: "course site page" }[type as "docx"]; // prettier-ignore
    const note = text.length > TEXT_LIMIT ? `Only the first ${TEXT_LIMIT.toLocaleString()} characters are read.` : null;
    return { kind: k, label, takenAt: null, pages: [textPage(text)], note };
  }
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
