import type { BBox } from "@/lib/schemas/evidence";

// Plain geometry on 0-1 image coordinates: outlines from SAM masks, which
// object a quote's box sits in, and areas. No pixels here, so it runs anywhere.

export type Point = [number, number];

/** Convex hull (monotone chain), counter-clockwise, no repeated first point. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/**
 * The outline of a mask as a convex polygon in 0-1 image coordinates. The raster is row-major, `width` by `height`,
 * and covers `bounds` (source pixels) of a `frame`-sized image. Sticky notes, sheets, and boards are convex enough.
 */
export function maskOutline(
  raster: Uint8Array,
  width: number,
  height: number,
  bounds: { left: number; top: number; right: number; bottom: number },
  frame: { w: number; h: number },
): Point[] {
  const sx = (bounds.right - bounds.left) / width;
  const sy = (bounds.bottom - bounds.top) / height;
  const edges: Point[] = [];
  for (let r = 0; r < height; r++) {
    let first = -1;
    let last = -1;
    for (let c = 0; c < width; c++)
      if (raster[r * width + c]) {
        if (first < 0) first = c;
        last = c;
      }
    if (first < 0) continue;
    // Pixel corners, so a one-row mask still has area.
    for (const y of [r, r + 1])
      edges.push([bounds.left + first * sx, bounds.top + y * sy], [bounds.left + (last + 1) * sx, bounds.top + y * sy]);
  }
  const round = (v: number) => Math.round(v * 10_000) / 10_000;
  return convexHull(edges).map(([x, y]) => [round(x / frame.w), round(y / frame.h)]);
}

export function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function pointInPolygon([x, y]: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const center = (b: BBox): Point => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
export const boxArea = (b: BBox) => (b.x1 - b.x0) * (b.y1 - b.y0);

export function iou(a: BBox, b: BBox): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (boxArea(a) + boxArea(b) - inter);
}
