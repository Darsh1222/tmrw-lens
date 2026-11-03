"use client";

import { useEffect, useState } from "react";
import { useReducedMotion, useSeen } from "./useSeen";
import type { Status } from "@/lib/plan/types";
import type { Evidence } from "@/lib/schemas/evidence";
import type { Input } from "./types";

// The source with what Lens read from it drawn on top: SAM 3.1's outline of
// each sticky note, sheet, or board in gilt, and a box around each quote.
// When results arrive the outlines draw on one by one (80ms apart), then the
// line boxes, and then the plan's cards arrive: only once the photo is in view
// (useSeen), paused while it isn't, with a Replay after; not at all under
// reduced motion. The selected item is drawn strongest.

export type Mark = { id: string; evidence: Evidence; status: Status };

const STAGGER = 80;

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
  const { attach, started, visible } = useSeen();
  const reduced = useReducedMotion();
  const [round, setRound] = useState(0);
  // Shapes that finished drawing in this round of this reveal; all of them means the outlines are done.
  const [drawn, setDrawn] = useState({ key: "", n: 0 });
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

  const key = `${reveal}:${round}`;
  // Each region is drawn twice (a dark line under the gilt); each box once.
  const total = regions.length * 2 + boxes.length;
  const finished = reduced || !reveal || total === 0 || (drawn.key === key && drawn.n >= total);
  useEffect(() => {
    if (reveal && started && finished) onRevealed();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per new set of readings, once seen and drawn
  }, [reveal, started, finished]);

  if (!input || !page) return null;
  // Shapes are keyed by `reveal` and the replay round, so new readings (or Replay) remount them and they draw again.
  const animate = started && reveal > 0 && !reduced;
  const state = !reveal || reduced || finished ? "done" : !started ? "idle" : visible ? "playing" : "paused";
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
      <div ref={attach} data-anim={state}>
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
              <svg
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                className={`absolute inset-0 h-full w-full ${state === "paused" ? "anim-paused" : ""}`}
                onAnimationEnd={(e) =>
                  e.animationName === "forum-draw" &&
                  setDrawn((x) => (x.key === key ? { key, n: x.n + 1 } : { key, n: 1 }))
                }
              >
                {/* Each outline is gilt over a thin dark line, so it reads on a pale wall or a dark desk alike. */}
                {regions.map((m, n) =>
                  (["var(--tm-outline-under)", "var(--tm-gilt)"] as const).map((stroke, layer) => (
                    <polygon
                      key={`r-${n}-${layer}-${key}`}
                      points={m.evidence.region!.outline.map(([x, y]) => `${x},${y}`).join(" ")}
                      pathLength={1}
                      className={animate ? "forum-draw" : ""}
                      style={delay(n)}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={layer ? 2.5 : 5}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )),
                )}
                {ordered.map((m, n) => {
                  const b = m.evidence.bbox!;
                  const on = m.id === selected;
                  return (
                    <rect
                      key={`b-${m.id}-${m.evidence.quote}-${key}`}
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
              <figcaption className="flex items-start justify-between gap-3 text-xs text-ink-2">
                <span>
                  Outlined by SAM 3.1: {regions.length} {regions.length === 1 ? "object" : "objects"}, each item tied to
                  the one it&apos;s written on.
                </span>
                {/* Always laid out, shown once drawn, so it moves nothing when it appears. */}
                <button
                  type="button"
                  onClick={() => setRound((r) => r + 1)}
                  className={`shrink-0 underline decoration-line-strong underline-offset-4 hover:text-ink ${state === "done" && !reduced && reveal ? "" : "invisible"}`} // prettier-ignore
                  tabIndex={state === "done" && !reduced && reveal ? 0 : -1}
                  aria-hidden={!(state === "done" && !reduced && reveal)}
                >
                  Replay
                </button>
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
