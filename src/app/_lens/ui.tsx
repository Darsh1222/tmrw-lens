"use client";

import { ArrowsLeftRight, Check, Question } from "@phosphor-icons/react";
import type { Status } from "@/lib/plan/types";
import type { BBox, Evidence } from "@/lib/schemas/evidence";
import type { PreparedPage } from "./prepare";

// Shared pieces in Forum's vocabulary: status chips, buttons, course colours,
// and evidence crops.

export type Pastel = "sage" | "powder" | "blush" | "lavender" | "butter";
const PASTELS: Pastel[] = ["powder", "sage", "lavender", "butter", "blush"];

/** One calm colour per course, stable for a set of courses (alphabetical), the same everywhere it appears. */
export function palette(courses: (string | null)[]): (course: string | null) => Pastel {
  const known = [...new Set(courses.filter((c): c is string => !!c))].sort();
  return (course) => (course && known.includes(course) ? PASTELS[known.indexOf(course) % PASTELS.length] : "powder");
}

export const STATUS: Record<Status, { label: string; tone: Pastel; Icon: typeof Check }> = {
  verified: { label: "Verified", tone: "sage", Icon: Check },
  needs_question: { label: "Needs a look", tone: "butter", Icon: Question },
  unverified: { label: "Needs a look", tone: "butter", Icon: Question },
  conflict: { label: "Sources disagree", tone: "blush", Icon: ArrowsLeftRight },
};

export function Chip({ status, className = "" }: { status: Status; className?: string }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs text-ink ${className}`}
      style={{ background: `var(--tm-${s.tone})` }}
    >
      <s.Icon size={12} weight="bold" aria-hidden />
      {s.label}
    </span>
  );
}

/** Kept for older call sites: the status chip. */
export const Badge = Chip;

export function Swatch({ tone, className = "" }: { tone: Pastel; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3 w-3 shrink-0 rounded-[4px] border border-line-strong ${className}`}
      style={{ background: `var(--tm-${tone})` }}
    />
  );
}

export { buttonClass } from "./styles";

/** The part of a page an evidence box covers, padded a little, drawn from the page image, with its SAM outline. */
export function Crop({
  page,
  evidence,
  className = "",
  outline = true,
  maxHeight = 160,
}: {
  page: PreparedPage;
  evidence: Evidence;
  className?: string;
  outline?: boolean;
  maxHeight?: number;
}) {
  const b = evidence.bbox;
  if (!page.url || !b)
    return <blockquote className={`border-l-2 border-line-strong pl-3 text-sm italic ${className}`}>{evidence.quote}</blockquote>; // prettier-ignore
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  // Show the whole SAM object when there is one (the sticky note, the sheet); else the line with some room.
  const r = evidence.region?.outline;
  const xs = r ? r.map(([x]) => x) : [b.x0, b.x1];
  const ys = r ? r.map(([, y]) => y) : [b.y0, b.y1];
  const padX = 0.02;
  const padY = r ? 0.02 : (b.y1 - b.y0) * 0.6;
  const box: BBox = {
    x0: clamp(Math.min(...xs, b.x0) - padX),
    y0: clamp(Math.min(...ys, b.y0) - padY),
    x1: clamp(Math.max(...xs, b.x1) + padX),
    y1: clamp(Math.max(...ys, b.y1) + padY),
  };
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const aspect = (w * page.width) / (h * page.height);
  const local = (x: number, y: number) => `${((x - box.x0) / w).toFixed(4)},${((y - box.y0) / h).toFixed(4)}`;
  return (
    <div
      role="img"
      aria-label={`From the source: ${evidence.quote}`}
      className={`relative w-full overflow-hidden rounded-lg border border-line bg-no-repeat ${className}`}
      style={{
        aspectRatio: `${aspect}`,
        maxWidth: `${maxHeight * aspect}px`,
        backgroundImage: `url(${page.url})`,
        backgroundSize: `${100 / w}% ${100 / h}%`,
        backgroundPosition: `${w < 1 ? (box.x0 / (1 - w)) * 100 : 0}% ${h < 1 ? (box.y0 / (1 - h)) * 100 : 0}%`,
      }}
    >
      {outline && (
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          {r && (
            <polygon
              points={r.map(([x, y]) => local(x, y)).join(" ")}
              fill="none"
              stroke="var(--tm-gilt)"
              strokeWidth={2}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <rect
            x={(b.x0 - box.x0) / w}
            y={(b.y0 - box.y0) / h}
            width={(b.x1 - b.x0) / w}
            height={(b.y1 - b.y0) / h}
            rx={0.01}
            fill="color-mix(in srgb, var(--tm-butter) 35%, transparent)"
            stroke="var(--tm-text)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </div>
  );
}

export function money(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
