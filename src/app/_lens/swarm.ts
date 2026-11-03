"use client";

// The SAM moment, finished: when the plan's cards land, ink streams from each
// outline SAM drew on the photo into the cards of the items written on it, so
// you see which note became which card. Canvas 2D over the page, at most 400
// particles, over in 1.2 seconds, then the canvas is gone. Nothing under it
// moves; it never runs under reduced motion or when there's nothing to connect.
// If frames come slow (an older phone), it draws every other particle.

const MAX = 400;
const TOTAL_MS = 1200;

/** Start in page coordinates; the end is a spot in its card, measured again every frame, so a scroll or a card still
 * settling never leaves the stream pointing at where the card was. */
type P = {
  x0: number;
  y0: number;
  bend: number;
  card: HTMLElement;
  fx: number;
  fy: number;
  delay: number;
  dur: number;
};

const inView = (r: DOMRect) => r.bottom > 0 && r.top < window.innerHeight && r.width > 0;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** A random point on a polygon (points in the svg's 0-1 box), in page pixels. */
function onOutline(poly: SVGPolygonElement, box: DOMRect): [number, number] {
  const pts = Array.from(poly.points, (p) => [p.x, p.y] as const);
  const i = Math.floor(Math.random() * pts.length);
  const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
  const t = Math.random();
  return [box.left + (a[0] + (b[0] - a[0]) * t) * box.width, box.top + (a[1] + (b[1] - a[1]) * t) * box.height];
}

export function swarm(): void {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const pairs: { poly: SVGPolygonElement; box: DOMRect; card: HTMLElement }[] = [];
  for (const poly of document.querySelectorAll<SVGPolygonElement>("polygon[data-swarm]")) {
    const svg = poly.ownerSVGElement;
    if (!svg) continue;
    const box = svg.getBoundingClientRect();
    for (const id of (poly.dataset.swarm ?? "").split(" ").filter(Boolean)) {
      const card = document.querySelector<HTMLElement>(`#prove [data-item="${CSS.escape(id)}"]`);
      if (card && inView(card.getBoundingClientRect())) pairs.push({ poly, box, card });
    }
  }
  if (!pairs.length) return;

  const each = Math.max(6, Math.floor(MAX / pairs.length));
  const ps: P[] = [];
  for (const { poly, box, card } of pairs)
    for (let k = 0; k < each && ps.length < MAX; k++) {
      const [x0, y0] = onOutline(poly, box);
      // A gentle arc, bent to one side, so the streams read as flowing rather than shot.
      ps.push({ x0: x0 + window.scrollX, y0: y0 + window.scrollY, bend: (Math.random() - 0.5) * 160, card, fx: 0.2 + Math.random() * 0.6, fy: 0.25 + Math.random() * 0.5, delay: Math.random() * 380, dur: 620 + Math.random() * 200 }); // prettier-ignore
    }

  const c = document.createElement("canvas");
  c.setAttribute("aria-hidden", "true");
  Object.assign(c.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "30" }); // prettier-ignore
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(window.innerWidth * dpr);
  c.height = Math.round(window.innerHeight * dpr);
  document.body.appendChild(c);
  const g = c.getContext("2d");
  if (!g) return c.remove();
  g.scale(dpr, dpr);
  g.fillStyle = getComputedStyle(document.body).color;

  const start = performance.now();
  let last = start;
  let slow = 0;
  let step = 1;
  const frame = (now: number) => {
    const t = now - start;
    // Two slow frames in a row: draw half as many from then on.
    slow = now - last > 24 ? slow + 1 : 0;
    if (slow >= 2) step = 2;
    last = now;
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const rects = new Map<HTMLElement, DOMRect>();
    for (let i = 0; i < ps.length; i += step) {
      const p = ps[i];
      const u = (t - p.delay) / p.dur;
      if (u <= 0 || u >= 1) continue;
      let r = rects.get(p.card);
      if (!r) rects.set(p.card, (r = p.card.getBoundingClientRect()));
      const x0 = p.x0 - window.scrollX, y0 = p.y0 - window.scrollY; // prettier-ignore
      const x1 = r.left + r.width * p.fx, y1 = r.top + r.height * p.fy; // prettier-ignore
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1; // prettier-ignore
      const cx = (x0 + x1) / 2 - (dy / len) * p.bend, cy = (y0 + y1) / 2 + (dx / len) * p.bend; // prettier-ignore
      const e = ease(u);
      const x = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * cx + e * e * x1;
      const y = (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * cy + e * e * y1;
      g.globalAlpha = 0.75 * Math.min(1, u / 0.15, (1 - u) / 0.25);
      g.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
    }
    if (t < TOTAL_MS) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}
