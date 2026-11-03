"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion, useSeen } from "./useSeen";

// The hero's background: faint topographic lines, like a map of the week. The
// ground rises where the sample week is busy (Wednesday to Friday, the right of
// the hero, behind the preview), so the lines bunch up there and stay sparse
// behind the words. It drifts slowly, only while it's on screen; on a phone or
// under reduced motion it's one still frame. Canvas only: no layout, no DOM.

/** The sample week's load by day (Mon-Sun), the hills' heights. */
const LOAD = [2, 3, 5, 6, 4, 1, 1];
const CELL = 14;
const LEVELS = 11;

function field(x: number, y: number, t: number) {
  // Each busy day is a hill toward the right half; two slow waves keep it from looking computed.
  let v = 0.18 * Math.sin(x * 2.1 + t * 0.6) * Math.cos(y * 1.7 - t * 0.4);
  for (let d = 0; d < 7; d++) {
    const cx = 0.48 + d * 0.075;
    const cy = 0.3 + ((d * 37) % 5) * 0.12;
    const dx = x - cx - 0.02 * Math.sin(t * 0.5 + d);
    const dy = y - cy - 0.02 * Math.cos(t * 0.4 + d);
    v += (LOAD[d] / 6) * Math.exp(-(dx * dx + dy * dy) / 0.018);
  }
  return v;
}

/** Marching squares: the level lines of the field on a coarse grid, as segments. */
function draw(g: CanvasRenderingContext2D, w: number, h: number, t: number, ink: string) {
  g.clearRect(0, 0, w, h);
  const cols = Math.ceil(w / CELL) + 1;
  const rows = Math.ceil(h / CELL) + 1;
  const s = Math.max(w, h);
  const v = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) v[j * cols + i] = field((i * CELL) / s, (j * CELL) / s, t); // prettier-ignore
  g.strokeStyle = ink;
  g.lineWidth = 1;
  g.beginPath();
  for (let k = 1; k <= LEVELS; k++) {
    const L = k * 0.085 - 0.1;
    for (let j = 0; j < rows - 1; j++)
      for (let i = 0; i < cols - 1; i++) {
        const a = v[j * cols + i], b = v[j * cols + i + 1], c = v[(j + 1) * cols + i + 1], d = v[(j + 1) * cols + i]; // prettier-ignore
        const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x = i * CELL,
          y = j * CELL;
        const top = [x + (CELL * (L - a)) / (b - a), y] as const;
        const right = [x + CELL, y + (CELL * (L - b)) / (c - b)] as const;
        const bottom = [x + (CELL * (L - d)) / (c - d), y + CELL] as const;
        const left = [x, y + (CELL * (L - a)) / (d - a)] as const;
        const seg = (p: readonly [number, number], q: readonly [number, number]) => {
          g.moveTo(p[0], p[1]);
          g.lineTo(q[0], q[1]);
        };
        switch (idx) {
          case 1:
          case 14: seg(left, bottom); break; // prettier-ignore
          case 2:
          case 13: seg(bottom, right); break; // prettier-ignore
          case 3:
          case 12: seg(left, right); break; // prettier-ignore
          case 4:
          case 11: seg(top, right); break; // prettier-ignore
          case 6:
          case 9: seg(top, bottom); break; // prettier-ignore
          case 7:
          case 8: seg(left, top); break; // prettier-ignore
          case 5: seg(left, top); seg(bottom, right); break; // prettier-ignore
          case 10: seg(left, bottom); seg(top, right); break; // prettier-ignore
        }
      }
  }
  g.stroke();
}

export function Contours() {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const { attach, visible } = useSeen();
  const reduced = useReducedMotion();
  // Where the drift is, kept across pauses so it goes on from the same place.
  const time = useRef(0);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const still = reduced || window.matchMedia("(max-width: 767px)").matches;
    let raf = 0;
    let last = 0;
    const size = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return r;
    };
    let box = size();
    const ink = () => getComputedStyle(c).color;
    draw(g, box.width, box.height, time.current, ink());
    const ro = new ResizeObserver(() => {
      box = size();
      draw(g, box.width, box.height, time.current, ink());
    });
    ro.observe(c);
    // About 20 frames a second is plenty for something this slow; a frame that runs long makes it skip, not stutter.
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 50) return;
      time.current += Math.min(now - last, 100) / 9000;
      last = now;
      draw(g, box.width, box.height, time.current, ink());
    };
    if (!still && visible)
      raf = requestAnimationFrame((now) => {
        last = now;
        tick(now);
      });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduced, visible]);

  return (
    <div ref={attach} aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <canvas
        ref={canvas}
        className="h-full w-full text-ink opacity-[0.07] [mask-image:linear-gradient(to_right,transparent,black_45%)]"
      />
    </div>
  );
}
