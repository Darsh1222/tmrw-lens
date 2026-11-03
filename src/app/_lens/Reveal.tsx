"use client";

import { useCallback, useState } from "react";
import { useReducedMotion, useSeen } from "./useSeen";

// Kinetic type: a heading's words come out from under a paper-coloured cover,
// one after another, once. The words themselves are drawn from the first frame
// (only the cover moves, transform-only), so the text is there for screen
// readers, search, and the page's largest-paint timing, and no layout moves.
//
// `atLoad`: the hero's headline, on screen when the page opens: its covers are
// in the server HTML and slide away by CSS alone. Every other heading waits
// until it's seen (useSeen), pauses with the page when scrolled away, and is
// simply shown if it was already in view when the page loaded or under reduced
// motion. `*word*` is set in italic crimson.

type Tag = "h1" | "h2";

export function Reveal({
  as: As = "h2",
  text,
  id,
  className = "",
  atLoad = false,
}: {
  as?: Tag;
  text: string;
  id?: string;
  className?: string;
  atLoad?: boolean;
}) {
  // prettier-ignore
  const { attach, started, visible } = useSeen();
  const reduced = useReducedMotion();
  // Below the fold: covers go on after mount (never in the server HTML), and only if it's off screen then. A ref
  // callback runs before the first paint, so a heading already in view never flickers.
  const [armed, setArmed] = useState(false);
  const ref = useCallback(
    (el: HTMLHeadingElement | null) => {
      attach(el);
      if (!el || atLoad) return;
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight || r.bottom < 0) setArmed(true);
    },
    [attach, atLoad],
  );
  const state = atLoad ? "load" : !armed || reduced ? "static" : started ? (visible ? "on" : "paused") : "armed";
  let n = 0;
  return (
    <As id={id} ref={ref} data-kt={state} className={`kt ${className}`}>
      {text.split(/(\s+)/).map((w, i) => {
        if (/^\s+$/.test(w)) return w;
        const em = /^\*(.+)\*([.,]?)$/.exec(w);
        const word = em ? (
          <>
            <em className="text-crimson">{em[1]}</em>
            {em[2]}
          </>
        ) : (
          w
        );
        return (
          <span key={i} className="kt-w">
            {word}
            <span className="kt-c" aria-hidden style={{ animationDelay: `${(atLoad ? 120 : 0) + n++ * 55}ms` }} />
          </span>
        );
      })}
    </As>
  );
}
