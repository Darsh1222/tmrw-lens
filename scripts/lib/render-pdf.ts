import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Renders PDF pages to PNG in Node, for fixtures, smoke tests, and evals.
// The app renders pages in the browser instead, so this stays a dev dependency.

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

export async function renderPdfPages(pdf: Uint8Array, opts: { scale?: number; pages?: number[] } = {}) {
  const task = getDocument({
    data: pdf,
    // Fonts PDFs reference without embedding (Helvetica and friends).
    standardFontDataUrl: join(pdfjsRoot, "standard_fonts") + "/",
  });
  const doc = await task.promise;
  const wanted = opts.pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const out: { page: number; png: Buffer; width: number; height: number }[] = [];
  try {
    for (const n of wanted) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: opts.scale ?? 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // pdf.js's canvas types are the DOM's; @napi-rs/canvas is compatible at runtime.
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      out.push({ page: n, png: canvas.toBuffer("image/png"), width: canvas.width, height: canvas.height });
    }
  } finally {
    await task.destroy();
  }
  return out;
}
