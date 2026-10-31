"use client";

import type { Status } from "@/lib/plan/types";
import type { BBox, Evidence } from "@/lib/schemas/evidence";
import type { PreparedPage } from "./prepare";

// Small shared pieces: status badges and evidence crops.

export const STATUS: Record<Status, { mark: string; label: string; cls: string }> = {
  verified: { mark: "✓", label: "Verified", cls: "text-verified border-verified/40 bg-verified/10" },
  needs_question: { mark: "?", label: "One question", cls: "text-accent border-accent/40 bg-accent/10" },
  unverified: { mark: "!", label: "Check this", cls: "text-unverified border-unverified/50 bg-unverified/10" },
  conflict: { mark: "⇄", label: "Sources disagree", cls: "text-conflict border-conflict/40 bg-conflict/10" },
};

export function Badge({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}
    >
      <span aria-hidden>{s.mark}</span>
      {s.label}
    </span>
  );
}

/** The part of a page an evidence box covers, padded a little, drawn from the page image. */
export function Crop({
  page,
  evidence,
  className = "",
}: {
  page: PreparedPage;
  evidence: Evidence;
  className?: string;
}) {
  const b = evidence.bbox;
  if (!page.url || !b) return <blockquote className={`text-sm italic ${className}`}>“{evidence.quote}”</blockquote>;
  const pad = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const box: BBox = {
    x0: pad(b.x0 - 0.02, 0, 1),
    y0: pad(b.y0 - (b.y1 - b.y0) * 0.4, 0, 1),
    x1: pad(b.x1 + 0.02, 0, 1),
    y1: pad(b.y1 + (b.y1 - b.y0) * 0.4, 0, 1),
  };
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const aspect = (w * page.width) / (h * page.height);
  return (
    <div
      role="img"
      aria-label={`From the source: ${evidence.quote}`}
      className={`w-full rounded-md border border-border bg-no-repeat ${className}`}
      style={{
        aspectRatio: `${aspect}`,
        // At most 160px tall: a tall crop (a sticky note) gets narrower instead of stretching.
        maxWidth: `${160 * aspect}px`,
        backgroundImage: `url(${page.url})`,
        backgroundSize: `${100 / w}% ${100 / h}%`,
        backgroundPosition: `${w < 1 ? (box.x0 / (1 - w)) * 100 : 0}% ${h < 1 ? (box.y0 / (1 - h)) * 100 : 0}%`,
      }}
    />
  );
}

export function money(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
