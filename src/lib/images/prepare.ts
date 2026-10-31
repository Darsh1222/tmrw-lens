import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readExif } from "@/lib/images/exif";

export { readExif };

// Phone photos before they're read: upright (EXIF orientation applied), no
// bigger than the model needs, re-encoded as JPEG, which also drops every
// other EXIF field (location included). The capture time is kept: "Mon" on a
// whiteboard means the Monday after it was taken.

export const MAX_EDGE = 2048;

export type PreparedPhoto = {
  bytes: Uint8Array;
  mime: "image/jpeg";
  width: number;
  height: number;
  takenAt: string | null;
};

export async function preparePhoto(input: Uint8Array): Promise<PreparedPhoto> {
  const { takenAt } = readExif(input);
  // @napi-rs/canvas applies the EXIF orientation when it decodes, so the image is already upright here.
  const img = await loadImage(Buffer.from(input));
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const c = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return {
    bytes: new Uint8Array(c.toBuffer("image/jpeg", 90)),
    mime: "image/jpeg",
    width: c.width,
    height: c.height,
    takenAt,
  };
}
