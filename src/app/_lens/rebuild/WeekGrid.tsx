"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { clock, placeOf, span, type Block, type WeekModel } from "./week";

// The week as a calendar: days as columns, a compressed time axis, classes
// quiet, study sessions in their course's colour, deadlines as thin flagged
// lines, a Now line. During the rebuild the missed session turns into a dashed
// ghost, a curved path draws to its new time, and the block glides along it.
// Only transform and opacity animate; nothing else moves.

export type Phase = "before" | "missed" | "moving" | "after";

const AXIS = 64;
const HEAD = 48;
const GLIDE_MS = 600;
const DRAW_MS = 420;

const fill = (b: Block) =>
  b.kind === "class" ? "var(--tm-sunken)" : b.kind === "ghost" ? "transparent" : `var(--tm-${b.color ?? "powder"})`;

/** The blocks to draw in a phase: before the miss, with the missed one as a ghost, or after the diff. */
export function blocksFor(model: WeekModel, phase: Phase, missedId: string): Block[] {
  if (phase === "before") return model.before;
  if (phase === "missed")
    return model.before.map((b) =>
      b.id === missedId ? (model.after.find((a) => a.key === `ghost-${missedId}`) ?? b) : b,
    );
  return model.after;
}

function useWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [w, setW] = useState(720);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function WeekGrid({
  model,
  phase,
  missedId,
  showBands,
  badge,
  reduced,
  onMoved,
}: {
  model: WeekModel;
  phase: Phase;
  missedId: string;
  showBands: boolean;
  badge: boolean;
  reduced: boolean;
  onMoved?: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const width = useWidth(body);
  const colW = (width - AXIS) / model.days.length;
  const x = (col: number) => AXIS + col * colW + 4;
  const blocks = blocksFor(model, phase, missedId);
  const [open, setOpen] = useState<string | null>(null);

  // The glide: each moved block starts at its old slot and travels a curve to where it now is.
  useLayoutEffect(() => {
    if (phase !== "moving") return;
    if (reduced || !model.moves.length) {
      onMoved?.();
      return;
    }
    const animations: Animation[] = [];
    for (const m of model.moves) {
      const el = body.current?.querySelector<HTMLElement>(`[data-glide="${m.id}"]`);
      const path = body.current?.querySelector<SVGPathElement>(`[data-path="${m.id}"]`);
      const a = placeOf(model, m.from.day, m.from.start, m.from.end);
      const b = placeOf(model, m.to.day, m.to.start, m.to.end);
      const dx = x(a.col) - x(b.col);
      const dy = a.top - b.top;
      const cx = dx / 2;
      const cy = Math.min(0, dy) / 2 - 40;
      const keyframes = Array.from({ length: 25 }, (_, i) => {
        const t = i / 24;
        const px = (1 - t) ** 2 * dx + 2 * (1 - t) * t * cx;
        const py = (1 - t) ** 2 * dy + 2 * (1 - t) * t * cy;
        return { transform: `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)` };
      });
      if (path) animations.push(path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: DRAW_MS, easing: "ease-out", fill: "both" })); // prettier-ignore
      if (el) animations.push(el.animate(keyframes, { duration: GLIDE_MS, delay: 160, easing: "cubic-bezier(0.33, 1, 0.68, 1)", fill: "backwards" })); // prettier-ignore
    }
    let done = false;
    Promise.all(animations.map((an) => an.finished)).then(
      () => !done && onMoved?.(),
      () => {},
    );
    return () => {
      done = true;
      animations.forEach((an) => an.cancel());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per entry into "moving"
  }, [phase]);

  const showPaths = phase === "moving" || phase === "after";
  return (
    <div className="flex flex-col" role="group" aria-label="The week" data-phase={phase}>
      <div
        className="grid"
        style={{ gridTemplateColumns: `${AXIS}px repeat(${model.days.length}, 1fr)`, height: HEAD }}
      >
        <span />
        {model.days.map((d) => (
          <div key={d.iso} className="flex items-baseline gap-2 px-2 pt-2 text-sm">
            <span className="font-medium">{d.weekday}</span>
            <span style={{ color: "var(--tm-muted)" }}>{d.date}</span>
          </div>
        ))}
      </div>
      <div ref={body} className="relative" style={{ height: model.height }}>
        {/* Axis labels and hour lines; compressed hours are a thin gap. */}
        {
          model.rows.reduce<{ top: number; el: React.ReactNode[] }>(
            (acc, r, n) => {
              acc.el.push(
                <div key={n} className="absolute left-0 right-0" style={{ top: acc.top, height: r.px }}>
                  {r.label && (
                    <span
                      className="absolute -top-2 left-0 w-[56px] pr-2 text-right text-xs"
                      style={{ color: "var(--tm-muted)" }}
                    >
                      {r.label}
                    </span>
                  )}
                  <div
                    className="absolute right-0 top-0"
                    style={{ left: AXIS, borderTop: `1px ${r.label ? "solid" : "dashed"} var(--tm-border)` }}
                  />
                </div>,
              );
              acc.top += r.px;
              return acc;
            },
            { top: 0, el: [] },
          ).el
        }
        {model.days.map((d, col) => (
          <div
            key={d.iso}
            aria-hidden
            className="absolute top-0 bottom-0"
            style={{ left: AXIS + col * colW, width: colW, borderLeft: "1px solid var(--tm-border)" }}
          />
        ))}

        {/* Free time Tomorrow sent: only while Lens is finding open time. */}
        {model.bands.map((b, n) => {
          const p = placeOf(model, b.day, b.start, b.end);
          if (p.col < 0) return null;
          return (
            <div
              key={n}
              aria-hidden
              className="forum-in absolute rounded-md"
              style={{ left: x(p.col), width: colW - 8, top: p.top, height: p.height, background: "var(--tm-band)", opacity: showBands ? 1 : 0, transform: "none" }} // prettier-ignore
            />
          );
        })}

        {blocks.map((b) => {
          const p = placeOf(model, b.day, b.start, b.end);
          if (p.col < 0) return null;
          const moved = !!b.moved;
          const label = `${b.title}, ${span(b.start, b.end, model.zone)}${b.kind === "class" ? ", class" : ""}${b.ghost ? `, ${b.ghost}` : ""}${moved ? ", moved here" : ""}`; // prettier-ignore
          const Tag = moved ? "button" : "div";
          return (
            <Tag
              key={b.key}
              data-item={b.id ?? undefined}
              data-kind={b.kind}
              data-day={b.day}
              data-start={new Date(b.start).toISOString()}
              data-end={new Date(b.end).toISOString()}
              data-glide={moved ? b.id! : undefined}
              aria-label={label}
              onClick={moved ? () => setOpen(open === b.key ? null : b.key) : undefined}
              onMouseEnter={moved ? () => setOpen(b.key) : undefined}
              onMouseLeave={moved ? () => setOpen(null) : undefined}
              onFocus={moved ? () => setOpen(b.key) : undefined}
              onBlur={moved ? () => setOpen(null) : undefined}
              className="forum-in absolute overflow-visible rounded-lg px-2 py-1 text-left text-xs"
              style={{
                left: x(p.col),
                width: colW - 8,
                top: p.top,
                height: p.height,
                background: fill(b),
                color: b.kind === "class" ? "var(--tm-text-2)" : "var(--tm-text)",
                border: b.kind === "ghost" ? "1px dashed var(--tm-border-strong)" : "1px solid var(--tm-border)",
                opacity: b.kind === "ghost" ? (b.ghost === "missed" ? 0.75 : 0.5) : 1,
                transform: "none",
                zIndex: moved ? 3 : b.kind === "ghost" ? 1 : 2,
              }}
            >
              <span className="block truncate font-medium">{b.title}</span>
              <span className="block truncate" style={{ color: "var(--tm-text-2)" }}>
                {b.kind === "class"
                  ? `class · ${span(b.start, b.end, model.zone)}`
                  : b.ghost
                    ? b.ghost
                    : span(b.start, b.end, model.zone)}{" "}
                {/* prettier-ignore */}
              </span>
              {moved && (
                <span
                  className="forum-in absolute -top-3 right-2 rounded-md px-2 py-0.5 text-xs font-medium"
                  style={{ background: "var(--tm-surface)", border: "1px solid var(--tm-border-strong)", color: "var(--tm-text)", opacity: badge || open === b.key ? 1 : 0, transform: "none" }} // prettier-ignore
                >
                  Moved
                </span>
              )}
              {moved && b.reason && open === b.key && (
                <span
                  role="tooltip"
                  className="absolute left-0 top-full z-10 mt-2 w-60 rounded-lg p-2 text-xs"
                  style={{ background: "var(--tm-surface)", border: "1px solid var(--tm-border-strong)", color: "var(--tm-text)" }} // prettier-ignore
                >
                  Because {b.reason}.
                </span>
              )}
            </Tag>
          );
        })}

        {model.markers.map((m) => {
          const p = placeOf(model, m.day, m.at, m.at);
          if (p.col < 0) return null;
          const now = m.kind === "now";
          const color = now ? "var(--tm-text)" : "var(--tm-crimson)";
          return (
            <div
              key={m.key}
              data-marker={m.kind}
              className="pointer-events-none absolute flex items-center"
              style={{ left: AXIS + p.col * colW, width: colW, top: p.top - 1, zIndex: 4 }}
            >
              <div className="h-px flex-1" style={{ background: color }} />
              <span
                className="absolute -top-2.5 right-1 rounded px-1.5 text-xs"
                style={{ background: "var(--tm-bg)", color, border: `1px solid ${color}` }}
              >
                {now ? `Now · ${clock(m.at, model.zone)}` : `${m.title} · ${clock(m.at, model.zone)}`}
              </span>
            </div>
          );
        })}

        {/* The path each moved session travelled. */}
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0"
          width={width}
          height={model.height}
          style={{ zIndex: 2 }}
        >
          {model.moves.map((m) => {
            const a = placeOf(model, m.from.day, m.from.start, m.from.end);
            const b = placeOf(model, m.to.day, m.to.start, m.to.end);
            const x1 = x(a.col) + (colW - 8) / 2;
            const y1 = a.top + a.height / 2;
            const x2 = x(b.col) + (colW - 8) / 2;
            const y2 = b.top + b.height / 2;
            const cx = (x1 + x2) / 2;
            const cy = Math.min(y1, y2) - 40;
            return (
              <path
                key={m.id}
                data-path={m.id}
                d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                pathLength={1}
                fill="none"
                stroke="var(--tm-text-2)"
                strokeWidth={1.5}
                strokeDasharray="1"
                strokeLinecap="round"
                style={{
                  opacity: showPaths ? (phase === "after" ? 0.45 : 1) : 0,
                  transition: "opacity 280ms ease-out",
                }}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
