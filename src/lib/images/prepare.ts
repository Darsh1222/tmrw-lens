import { createCanvas, loadImage } from "@napi-rs/canvas";

// Phone photos before they're read: upright (EXIF orientation applied), no
// bigger than the model needs, re-encoded as JPEG, which also drops every
// other EXIF field (location included). The capture time is kept: "Mon" on a
// whiteboard means the Monday after it was taken.

const MAX_EDGE = 2048;

type Exif = { orientation: number; takenAt: string | null };

/** Reads Orientation and DateTimeOriginal (+ OffsetTimeOriginal) from a JPEG's APP1 segment. */
export function readExif(bytes: Uint8Array): Exif {
  const out: Exif = { orientation: 1, takenAt: null };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return out;
  let p = 2;
  while (p + 4 <= v.byteLength) {
    const marker = v.getUint16(p);
    const len = v.getUint16(p + 2);
    if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) return parseTiff(v, p + 10, out); // "Exif"
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    p += 2 + len;
  }
  return out;
}

function parseTiff(v: DataView, base: number, out: Exif): Exif {
  if (base + 8 > v.byteLength) return out;
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o: number) => v.getUint16(base + o, le);
  const u32 = (o: number) => v.getUint32(base + o, le);
  const ascii = (o: number, n: number) => {
    let s = "";
    for (let i = 0; i < n - 1 && base + o + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(base + o + i));
    return s;
  };
  const entries = (ifd: number) => {
    if (base + ifd + 2 > v.byteLength) return [];
    return Array.from({ length: u16(ifd) }, (_, i) => {
      const e = ifd + 2 + i * 12;
      const count = u32(e + 4);
      return { tag: u16(e), count, at: count > 4 ? u32(e + 8) : e + 8, short: u16(e + 8) };
    }).filter((e) => base + e.at < v.byteLength);
  };
  let exifIfd = 0;
  for (const e of entries(u32(4))) {
    if (e.tag === 0x0112) out.orientation = e.short;
    if (e.tag === 0x8769) exifIfd = u32(e.at);
  }
  if (!exifIfd) return out;
  let taken: string | null = null;
  let offset: string | null = null;
  for (const e of entries(exifIfd)) {
    if (e.tag === 0x9003) taken = ascii(e.at, e.count); // "2026:10:28 10:51:02"
    if (e.tag === 0x9011) offset = ascii(e.at, e.count); // "-04:00"
  }
  const m = taken && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(taken);
  // Without an offset the time is the camera's local time; the caller pairs it with the person's zone.
  if (m)
    out.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : ""}`;
  return out;
}

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
