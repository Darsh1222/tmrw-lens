"use client";

import type { Status } from "@/lib/plan/types";
import type { Evidence } from "@/lib/schemas/evidence";
import type { Input } from "./types";

// The source image with every quote on it highlighted: the SAM outline of the
// sticky note, sheet, or board when there is one, else the model's box around
// the line. The selected item's highlight is drawn strongest. Tabs switch
// between inputs, and between the pages of a PDF.

export type Mark = { id: string; evidence: Evidence; status: Status };

const STROKE: Record<Status, string> = {
  verified: "var(--lens-verified)",
  needs_question: "var(--lens-accent)",
  unverified: "var(--lens-unverified)",
  conflict: "var(--lens-conflict)",
};

function Shape({ m, selected, onSelect }: { m: Mark; selected: boolean; onSelect: (id: string) => void }) {
  const e = m.evidence;
  const common = {
    fill: selected ? "color-mix(in srgb, var(--lens-highlight) 28%, transparent)" : "transparent",
    stroke: STROKE[m.status],
    strokeWidth: selected ? 3 : 1.5,
    vectorEffect: "non-scaling-stroke" as const,
    className: "cursor-pointer",
    onClick: () => onSelect(m.id),
  };
  // The object outline marks where the item sits; the box marks its line inside it.
  return (
    <g opacity={selected ? 1 : 0.7}>
      {e.region && selected && (
        <polygon
          points={e.region.outline.map(([x, y]) => `${x},${y}`).join(" ")}
          {...common}
          fill="transparent"
          strokeDasharray="6 4"
        />
      )}
      {e.bbox ? (
        <rect
          x={e.bbox.x0}
          y={e.bbox.y0}
          width={e.bbox.x1 - e.bbox.x0}
          height={e.bbox.y1 - e.bbox.y0}
          rx={0.004}
          {...common}
        >
          <title>{e.quote}</title>
        </rect>
      ) : null}
    </g>
  );
}

export function Viewer({
  inputs,
  at,
  onAt,
  marks,
  selected,
  onSelect,
}: {
  inputs: Input[];
  at: { input: string; page: number };
  onAt: (at: { input: string; page: number }) => void;
  marks: Mark[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const input = inputs.find((i) => i.id === at.input) ?? inputs[0];
  if (!input) return null;
  const page = input.pages[Math.min(at.page, input.pages.length - 1)];
  const here = marks.filter(
    (m) => m.evidence.source_id === input.id && (m.evidence.page ?? null) === (page.page ?? null),
  );
  const ordered = [...here.filter((m) => m.id !== selected), ...here.filter((m) => m.id === selected)];
  return (
    <section aria-label="Sources" className="flex flex-col gap-2">
      <div role="tablist" className="flex gap-1 overflow-x-auto pb-1">
        {inputs.map((i) => (
          <button
            key={i.id}
            role="tab"
            aria-selected={i.id === input.id}
            onClick={() => onAt({ input: i.id, page: 0 })}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-sm ${i.id === input.id ? "border-accent bg-accent/10 text-text" : "border-border text-text-secondary hover:text-text"}`}
          >
            {i.label}
          </button>
        ))}
      </div>
      {input.pages.length > 1 && (
        <div className="flex items-center gap-1 text-sm text-text-secondary">
          Page
          {input.pages.map((p, n) => (
            <button
              key={n}
              onClick={() => onAt({ input: input.id, page: n })}
              aria-current={n === at.page}
              className={`min-w-7 rounded px-1.5 py-0.5 ${n === at.page ? "bg-accent text-white" : "hover:bg-surface"}`}
            >
              {p.page}
            </button>
          ))}
        </div>
      )}
      {page.url ? (
        <div className="relative overflow-hidden rounded-lg border border-border bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimizable asset */}
          <img
            src={page.url}
            alt={`The ${input.label}${page.page ? `, page ${page.page}` : ""}`}
            className="block h-auto w-full"
          />
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            {ordered.map((m) => (
              <Shape key={`${m.id}-${m.evidence.quote}`} m={m} selected={m.id === selected} onSelect={onSelect} />
            ))}
          </svg>
        </div>
      ) : (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 text-sm">
          {page.text}
        </pre>
      )}
    </section>
  );
}
