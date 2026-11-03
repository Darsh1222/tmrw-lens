"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// When an animation may run: per animated element, only while the person can
// actually see it. It starts once 60% of the element is in view, not counting
// the bottom tenth of the screen (so it isn't just peeking at the edge); an
// element taller than the screen starts once it covers half the screen
// instead. It pauses below 20% and resumes from the same step. On load it only
// plays if it's already that visible.

const THRESHOLDS = Array.from({ length: 51 }, (_, i) => i / 50);
export const START_RATIO = 0.6;
export const START_COVER = 0.5;
export const PAUSE_BELOW = 0.2;

export type Seen = {
  /** It has been seen enough to start (latches). */
  started: boolean;
  /** It's in view enough to keep running. */
  visible: boolean;
  /** Resolves once it's in view enough to run (immediately if it is). */
  whenVisible: () => Promise<void>;
  /** Resolves once it's seen enough to start. */
  whenStarted: () => Promise<void>;
  /** Whether it's in view right now (for code that runs between renders). */
  isVisible: () => boolean;
  /** Put on the animated element: watching starts whenever it mounts (it may mount after the first render). */
  attach: (el: Element | null) => void;
  /** The element, once mounted. */
  node: Element | null;
};

const subscribe = (cb: () => void) => {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
export const useReducedMotion = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

export function useSeen(): Seen {
  const [el, setEl] = useState<Element | null>(null);
  const [started, setStarted] = useState(false);
  const [visible, setVisible] = useState(false);
  const live = useRef({ started: false, visible: false });
  const waiters = useRef<{ started: (() => void)[]; visible: (() => void)[] }>({ started: [], visible: [] });

  useEffect(() => {
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        const screen = window.innerHeight;
        const tall = e.boundingClientRect.height > screen;
        // A tall element can never be 60% visible; how much of the screen it fills is what counts.
        const shown = tall ? e.intersectionRect.height / screen : e.intersectionRatio;
        const startNow = shown >= (tall ? START_COVER : START_RATIO);
        const visibleNow = e.isIntersecting && shown >= PAUSE_BELOW;
        if (startNow && !live.current.started) {
          live.current.started = true;
          setStarted(true);
          waiters.current.started.splice(0).forEach((f) => f());
        }
        live.current.visible = visibleNow;
        setVisible(visibleNow);
        if (visibleNow) waiters.current.visible.splice(0).forEach((f) => f());
      },
      { threshold: THRESHOLDS, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el]);

  const whenVisible = useCallback(
    () => (live.current.visible ? Promise.resolve() : new Promise<void>((r) => waiters.current.visible.push(r))),
    [],
  );
  const whenStarted = useCallback(
    () => (live.current.started ? Promise.resolve() : new Promise<void>((r) => waiters.current.started.push(r))),
    [],
  );
  const isVisible = useCallback(() => live.current.visible, []);
  return { started, visible, whenVisible, whenStarted, isVisible, attach: setEl, node: el };
}

/** A wait that only counts time while the element is in view: a sequence pauses with it and resumes where it was. */
export function seenWait(seen: Pick<Seen, "whenVisible" | "isVisible">) {
  return async (ms: number) => {
    let left = ms;
    while (left > 0) {
      if (!seen.isVisible()) await seen.whenVisible();
      const step = Math.min(100, left);
      await new Promise((r) => setTimeout(r, step));
      if (seen.isVisible()) left -= step;
    }
  };
}
