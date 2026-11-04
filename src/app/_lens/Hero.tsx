"use client";

import Link from "next/link";
import { Contours } from "./Contours";
import { Reveal } from "./Reveal";
import { useEffect, useState } from "react";
import { buttonClass } from "./ui";
import { useReducedMotion, useSeen } from "./useSeen";

// The first screen: what Lens is, in one sentence, and the two ways in. Beside
// it, a small week where a missed session turns into a ghost and glides to its
// new slot, on a loop: it plays only while it's in view (useSeen), pauses where
// it is when it isn't, and holds the landed state 3 seconds before going again.
// Under reduced motion it shows the landed state, ghost and all.

function GlidePreview() {
  const { attach, started, visible } = useSeen();
  const reduced = useReducedMotion();
  const [round, setRound] = useState(0);
  const [done, setDone] = useState(false);
  const state = reduced || done ? "done" : !started ? "idle" : visible ? "playing" : "paused";
  // Landed: hold it a moment, then go again, but only while someone can see it.
  useEffect(() => {
    if (!done || reduced || !visible) return;
    const t = setTimeout(() => (setDone(false), setRound((r) => r + 1)), 3000);
    return () => clearTimeout(t);
  }, [done, reduced, visible]);
  const block = "absolute rounded-lg border border-line px-2 py-1.5 text-[11px] leading-tight";
  return (
    <div
      ref={attach}
      data-anim={state}
      onAnimationEnd={(e) => e.animationName === "glide-block" && setDone(true)}
      className={`glide relative w-full overflow-hidden rounded-2xl border border-line bg-card p-4 sm:p-5 ${state === "playing" ? "is-playing" : ""}`}
      role="img"
      aria-label="A small week: Calc practice was missed on Wednesday at 4 PM, so it moves to Thursday at 7:30 AM, before the quiz at 10 AM."
    >
      <div className="grid grid-cols-3 gap-2 pb-2 text-xs" aria-hidden>
        {["Wed", "Thu", "Fri"].map((d) => (
          <span key={d} className="font-medium">
            {d}
          </span>
        ))}
      </div>
      <div className="relative h-[248px]" aria-hidden>
        {[0, 1, 2].map((c) => (
          <div key={c} className="absolute bottom-0 top-0 border-l border-line" style={{ left: `${(c * 100) / 3}%` }} />
        ))}
        {/* Thu 7:30 AM is where it lands; Wed 4 PM is where it was. */}
        <div className={`${block} bg-well text-ink-2`} style={{ left: "calc(0% + 4px)", width: "calc(33.33% - 8px)", top: 60 }}>
          MATH141 lecture
          <br />
          class
        </div>
        <div className={`${block} bg-well text-ink-2`} style={{ left: "calc(33.33% + 4px)", width: "calc(33.33% - 8px)", top: 104 }}>
          ENGL101
          <br />
          class
        </div>
        <div className={`${block} bg-sage text-ink`} style={{ left: "calc(33.33% + 4px)", width: "calc(33.33% - 8px)", top: 168 }}>
          Essay outline
          <br />
          2–3 PM
        </div>
        <div className={`${block} bg-powder text-ink`} style={{ left: "calc(66.66% + 4px)", width: "calc(33.33% - 8px)", top: 140 }}>
          HIST reading
          <br />
          4–5 PM
        </div>
        <div className="absolute flex items-center" style={{ left: "33.33%", width: "33.33%", top: 50 }}>
          <div className="h-px flex-1 bg-crimson" />
          <span className="absolute -top-2.5 right-1 rounded border border-crimson bg-paper px-1 text-[10px] text-crimson">Quiz 3 · 10 AM</span>
        </div>
        <div className="absolute flex items-center" style={{ left: 0, width: "33.33%", top: 214 }}>
          <div className="h-px flex-1 bg-ink" />
          <span className="absolute -top-2.5 right-1 rounded border border-ink bg-paper px-1 text-[10px]">Now · 6:10 PM</span>
        </div>
        <div key={`g${round}`} className={`glide-ghost ${block} border-dashed border-line-strong text-ink-2`} style={{ left: "calc(0% + 4px)", width: "calc(33.33% - 8px)", top: 168, height: 40 }}>
          Calc practice
          <br />
          missed
        </div>
        <svg key={`p${round}`} className="glide-path absolute inset-0 h-full w-full" viewBox="0 0 300 248" preserveAspectRatio="none">
          <path d="M 50 188 Q 90 40 150 30" pathLength={1} fill="none" stroke="var(--tm-text-2)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="1 1" />
        </svg>
        <div key={`b${round}`} className={`glide-block ${block} bg-blush text-ink`} style={{ left: "calc(33.33% + 4px)", width: "calc(33.33% - 8px)", top: 12, height: 40 }}>
          Calc practice
          <br />
          MATH141
          <span className="glide-badge absolute -top-2.5 right-1 rounded border border-line-strong bg-card px-1 text-[10px]">Moved</span>
        </div>
      </div>
    </div>
  ); // prettier-ignore
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate grid items-center gap-10 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
      <Contours />
      <div className="flex flex-col gap-6">
        <span className="forum-caps">Tomorrow Lens</span>
        <Reveal as="h1" atLoad id="hero-title" className="forum-display text-[2.75rem] leading-[1.05] sm:text-6xl" text="Your week, read, verified, and *rebuilt* when life happens." />
        <p className="max-w-xl text-lg text-ink-2">
          Drop in a syllabus, schedule or whiteboard photo. Lens builds a plan you can verify. Miss a session, and it
          rebuilds the week.
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <a href="#missed-session" className={buttonClass("primary", "px-5")}>
              Try a missed session
            </a>
            <a href="#upload" className={buttonClass("quiet", "px-5")}>
              Upload your own
            </a>
          </div>
          <p className="text-sm text-ink-2">10 seconds, free, no sign-up.</p>
        </div>
        <p className="text-sm text-ink-2">
          0 invented dates in 210 · every rebuild rule kept in 204 runs ·{" "}
          <Link href="/evals" className="text-ink underline decoration-crimson underline-offset-4 hover:decoration-2">
            how it&apos;s measured
          </Link>
        </p>
      </div>
      <GlidePreview />
    </section>
  ); // prettier-ignore
}
