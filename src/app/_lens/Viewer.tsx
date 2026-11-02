"use client";

import { useEffect, useRef, useState } from "react";
import type { Status } from "@/lib/plan/types";
import type { Evidence } from "@/lib/schemas/evidence";
import type { Input } from "./types";

// The source with what Lens read from it drawn on top: SAM 3.1's outline of
// each sticky note, sheet, or board in gilt, and a box around each quote.
// When results arrive the outlines draw on one by one (80ms apart), then the
// line boxes, and then the plan's cards arrive; only once this is on screen,
// and not at all under reduced motion. The selected item is drawn strongest.

export type Mark = { id: string; evidence: Evidence; status: Status };

const STAGGER = 80;
const DRAW = 520;

function useInView<T extends Element>(ref: React.RefObject<T | null>) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Viewer({
  inputs,
  at,
  onAt,
  marks,
  selected,
  onSelect,
  reveal,
  onRevealed,
}: {
  inputs: Input[];
  at: { input: string; page: number };
  onAt: (at: { input: string; page: number }) => void;
  marks: Mark[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** Changes when new readings arrive: the outlines draw again. */
  reveal: number;
  onRevealed: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const inView = useInView(frame);
  const input = inputs.find((i) => i.id === at.input) ?? inputs[0];
  const page = input ? input.pages[Math.min(at.page, input.pages.length - 1)] : null;
  const here = page
    ? marks.filter((m) => m.evidence.source_id === input!.id && (m.evidence.page ?? null) === (page.page ?? null))
    : [];
  // One outline per SAM object, however many items sit on it.
  const regions = [
    ...new Map(
      here.filter((m) => m.evidence.region).map((m) => [JSON.stringify(m.evidence.region!.outline), m]),
    ).values(),
  ];
  const boxes = here.filter((m) => m.evidence.bbox);
  const shapes = regions.length + boxes.length;

  useEffect(() => {
    if (!inView || !reveal) return;
    const t = setTimeout(onRevealed, reducedMotion() ? 0 : Math.min(shapes, 24) * STAGGER + DRAW);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per new set of readings, once on screen
  }, [reveal, inView]);

  if (!input || !page) return null;
  // Shapes are keyed by `reveal`, so new readings remount them and they draw again; nothing redraws on a re-render.
  const animate = inView && reveal > 0;
  const delay = (n: number) => (animate ? { animationDelay: `${Math.min(n, 24) * STAGGER}ms` } : undefined);
  const ordered = [...boxes.filter((m) => m.id !== selected), ...boxes.filter((m) => m.id === selected)];

  return (
    <section aria-label="Sources" className="flex flex-col gap-3">
      <div role="tablist" aria-label="Your inputs" className="flex gap-2 overflow-x-auto pb-1">
        {inputs.map((i) => (
          <button
            key={i.id}
            role="tab"
            aria-selected={i.id === input.id}
            onClick={() => onAt({ input: i.id, page: 0 })}
            className={`min-h-9 shrink-0 rounded-lg px-3 text-sm ${i.id === input.id ? "bg-ink text-paper" : "border border-line-strong text-ink-2 hover:text-ink"}`}
          >
            {i.label}
          </button>
        ))}
      </div>
      {input.pages.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 text-sm text-ink-2" aria-label="Pages">
          <span className="mr-1">Page</span>
          {input.pages.map((p, n) => (
            <button
              key={n}
              onClick={() => onAt({ input: input.id, page: n })}
              aria-current={n === at.page}
              className={`min-h-9 min-w-9 rounded-md px-2 ${n === at.page ? "bg-ink text-paper" : "hover:bg-well"}`}
            >
              {p.page}
            </button>
          ))}
        </div>
      )}
      <div ref={frame}>
        {page.url ? (
          <figure className="flex flex-col gap-2">
            <div className="relative overflow-hidden rounded-xl border border-line bg-well">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimizable asset */}
              <img
                src={page.url}
                width={page.width}
                height={page.height}
                alt={`Your ${input.label}${page.page ? `, page ${page.page}` : ""}, with what Lens read outlined`}
                className="block h-auto w-full"
              />
              <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                {regions.map((m, n) => (
                  <polygon
                    key={`r-${n}-${reveal}`}
                    points={m.evidence.region!.outline.map(([x, y]) => `${x},${y}`).join(" ")}
                    pathLength={1}
                    className={animate ? "forum-draw" : ""}
                    style={delay(n)}
                    fill="none"
                    stroke="var(--tm-gilt)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {ordered.map((m, n) => {
                  const b = m.evidence.bbox!;
                  const on = m.id === selected;
                  return (
                    <rect
                      key={`b-${m.id}-${m.evidence.quote}-${reveal}`}
                      x={b.x0}
                      y={b.y0}
                      width={b.x1 - b.x0}
                      height={b.y1 - b.y0}
                      rx={0.004}
                      pathLength={1}
                      className={`cursor-pointer ${animate ? "forum-draw" : ""}`}
                      style={delay(regions.length + n)}
                      fill={on ? "color-mix(in srgb, var(--tm-butter) 45%, transparent)" : "transparent"}
                      stroke={m.status === "conflict" ? "var(--tm-crimson)" : "var(--tm-text)"}
                      strokeOpacity={on ? 1 : 0.55}
                      strokeWidth={on ? 2.5 : 1.25}
                      vectorEffect="non-scaling-stroke"
                      onClick={() => onSelect(m.id)}
                    >
                      <title>{m.evidence.quote}</title>
                    </rect>
                  );
                })}
              </svg>
            </div>
            {regions.length > 0 && (
              <figcaption className="text-xs text-ink-2">
                Outlined by SAM 3.1: {regions.length} {regions.length === 1 ? "object" : "objects"}, each item tied to
                the one it&apos;s written on.
              </figcaption>
            )}
          </figure>
        ) : (
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-well p-4 text-sm">
            {page.text}
          </pre>
        )}
      </div>
    </section>
  );
}
