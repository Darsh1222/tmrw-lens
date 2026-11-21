"use client";

import { useEffect } from "react";

/** Brief visual feedback for pointer and keyboard activation, without altering the action. */
export function ButtonFeedback() {
  useEffect(() => {
    const timers = new Map<HTMLButtonElement, number>();
    const press = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("button");
      if (!button || button.disabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const previous = timers.get(button);
      if (previous !== undefined) window.clearTimeout(previous);
      button.classList.remove("lens-press-feedback");
      void button.offsetWidth;
      button.classList.add("lens-press-feedback");
      timers.set(
        button,
        window.setTimeout(() => {
          button.classList.remove("lens-press-feedback");
          timers.delete(button);
        }, 360),
      );
    };
    document.addEventListener("click", press, true);
    return () => {
      document.removeEventListener("click", press, true);
      for (const [button, timer] of timers) {
        window.clearTimeout(timer);
        button.classList.remove("lens-press-feedback");
      }
    };
  }, []);
  return null;
}
