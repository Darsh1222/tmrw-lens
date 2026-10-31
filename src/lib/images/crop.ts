import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import type { Point } from "@/lib/images/geometry";
import type { BBox } from "@/lib/schemas/evidence";

// Crops for the second read. Box crops: a little padding keeps letters the box
// clipped; small crops are scaled up so the text is legible. Object crops: the
// SAM object's own bounds. Either way, with an outline, everything outside it
// is painted white, so a neighbouring note can't leak into the read.

function draw(img: Image, x0: number, y0: number, w: number, h: number, clip: Point[] | null): Uint8Array {
  const scale = Math.min(4, Math.max(1, 96 / h));
  const c = createCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  if (clip) {
    g.beginPath();
    clip.forEach(([x, y], i) => {
      const px = (x * img.width - x0) * scale;
      const py = (y * img.height - y0) * scale;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.closePath();
    g.clip();
  }
  g.drawImage(img, x0, y0, w, h, 0, 0, c.width, c.height);
  return new Uint8Array(c.toBuffer("image/png"));
}

/** Each box, padded; with `clips`, everything outside that box's object outline is painted white. */
export async function cropBoxes(image: Uint8Array, boxes: BBox[], clips?: (Point[] | null)[]): Promise<Uint8Array[]> {
  const img = await loadImage(Buffer.from(image));
  return boxes.map((b, i) => {
    // Boxes from the model can be a character short at either end; a re-read that loses a digit fails.
    const padX = 0.05;
    const padY = (b.y1 - b.y0) * 0.35;
    const x0 = Math.max(0, b.x0 - padX) * img.width;
    const y0 = Math.max(0, b.y0 - padY) * img.height;
    const w = Math.min(1, b.x1 + padX) * img.width - x0;
    const h = Math.min(1, b.y1 + padY) * img.height - y0;
    return draw(img, x0, y0, w, h, clips?.[i] ?? null);
  });
}

export async function cropObjects(
  image: Uint8Array,
  objects: { bbox: BBox; outline: Point[] }[],
): Promise<Uint8Array[]> {
  const img = await loadImage(Buffer.from(image));
  return objects.map(({ bbox: b, outline }) => {
    const x0 = b.x0 * img.width;
    const y0 = b.y0 * img.height;
    return draw(img, x0, y0, (b.x1 - b.x0) * img.width, (b.y1 - b.y0) * img.height, outline);
  });
}
