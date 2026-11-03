"use client";

import { PlayCircle, SealCheck, UploadSimple } from "@phosphor-icons/react";

// "How to try it": three numbered steps under the hero. Each is a link to where
// that step happens (the missed-session panel, the sample week's plan, the drop
// zone) and briefly highlights it on arrival, so it's clear where to look.

const STEPS = [
  { n: 1, Icon: PlayCircle, title: "Watch a rebuild", text: "Press “Try a missed session”.", hash: "missed-session", target: "missed-session" }, // prettier-ignore
  { n: 2, Icon: SealCheck, title: "See the proof", text: "Open the sample week and tap any date.", hash: "sample-week", target: "prove" }, // prettier-ignore
  { n: 3, Icon: UploadSimple, title: "Use your own", text: "Upload a syllabus, schedule screenshot or photo.", hash: "upload", target: "upload" }, // prettier-ignore
];

/** Outline the section a step jumps to for a moment, once it's there (the sample week's plan takes a beat to open). */
export function flash(id: string, wait = 0) {
  const started = Date.now();
  const tryIt = () => {
    const el = document.getElementById(id);
    if (!el && Date.now() - started < 4000) return void setTimeout(tryIt, 150);
    if (!el) return;
    el.removeAttribute("data-flash");
    void el.getBoundingClientRect(); // restart the animation if it's already on
    el.setAttribute("data-flash", "");
    setTimeout(() => el.removeAttribute("data-flash"), 1800);
  };
  setTimeout(tryIt, wait);
}

export function HowTo() {
  return (
    <section id="how" aria-labelledby="how-title" className="flex flex-col gap-6">
      <h2 id="how-title" className="forum-caps">
        How to try it
      </h2>
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n}>
            <a
              href={`#${s.hash}`}
              onClick={() => flash(s.target, s.hash === "sample-week" ? 900 : 400)}
              className="group flex h-full items-start gap-4 rounded-2xl border border-line bg-card p-5 transition-colors hover:border-line-strong hover:bg-well"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line-strong text-ink" aria-hidden>
                <s.Icon size={22} weight="light" />
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-xs text-ink-2">Step {s.n}</span>
                <span className="font-medium text-ink underline decoration-transparent underline-offset-4 group-hover:decoration-crimson">
                  {s.title}
                </span>
                <span className="text-sm text-ink-2">{s.text}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  ); // prettier-ignore
}
