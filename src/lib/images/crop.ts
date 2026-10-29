import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { BBox } from "@/lib/schemas/evidence";

// Crops a box out of an image for the second read. A little padding keeps
// letters the box clipped; small crops are scaled up so the text is legible.

export async function cropBoxes(image: Uint8Array, boxes: BBox[]): Promise<Uint8Array[]> {
  const img = await loadImage(Buffer.from(image));
  return boxes.map((b) => {
    // Boxes from the model can be a character short at either end; a re-read that loses a digit fails.
    const padX = 0.05;
    const padY = (b.y1 - b.y0) * 0.35;
    const x0 = Math.max(0, b.x0 - padX) * img.width;
    const y0 = Math.max(0, b.y0 - padY) * img.height;
    const w = Math.min(1, b.x1 + padX) * img.width - x0;
    const h = Math.min(1, b.y1 + padY) * img.height - y0;
    const scale = Math.min(4, Math.max(1, 96 / h));
    const c = createCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, x0, y0, w, h, 0, 0, c.width, c.height);
    return new Uint8Array(c.toBuffer("image/png"));
  });
}
