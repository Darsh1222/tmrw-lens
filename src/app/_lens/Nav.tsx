"use client";

import { List, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { buttonClass } from "./styles";

// The sticky top bar: the wordmark, three section links and GitHub, and the one
// primary action. On the home page the link for the section in view is
// underlined; on a phone the links fold into a full-width menu while the
// primary button stays in the bar.

const GITHUB = "https://github.com/Darsh1222/tmrw-lens";
/** Each link, and the sections that count as it when they're in view. */
const LINKS = [
  { label: "How it works", hash: "how", sections: ["how"] },
  { label: "Try it", hash: "upload", sections: ["upload", "prove", "missed-session"] },
  { label: "Results", hash: "results", sections: ["results"] },
];

function useActiveSection(on: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    const ids = LINKS.flatMap((l) => l.sections);
    const seen = new Map<string, number>();
    // A section is "in view" by how much of the band under the bar it fills; the most wins.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.intersectionRect.height : 0);
        const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
        setActive(best && best[1] > 0 ? best[0] : null);
      },
      { rootMargin: "-80px 0px -40% 0px", threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [on]);
  return active;
}

/** `home`: on the home page, links are in-page and the section in view is underlined; elsewhere they lead home. */
export function Nav({ home }: { home: boolean }) {
  const active = useActiveSection(home);
  const [open, setOpen] = useState(false);
  const href = (hash: string) => (home ? `#${hash}` : `/#${hash}`);
  const current = LINKS.find((l) => active && l.sections.includes(active))?.hash;

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const link = "inline-flex min-h-11 items-center rounded-lg px-3 text-ink-2 underline-offset-[10px] decoration-2 decoration-crimson hover:text-ink"; // prettier-ignore
  return (
    <>
      <nav aria-label="Main" className="flex items-center gap-1 text-sm">
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.hash} href={href(l.hash)} aria-current={current === l.hash ? "true" : undefined} className={`${link} ${current === l.hash ? "text-ink underline" : ""}`}>
              {l.label}
            </a>
          ))}
          <a href={GITHUB} className={link}>
            GitHub
          </a>
        </div>
        <a href={href("missed-session")} className={buttonClass("primary", "ml-1 whitespace-nowrap px-3 sm:ml-2 sm:px-4")}>
          Try a missed session
        </a>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="nav-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="grid h-11 w-11 place-items-center rounded-lg text-ink hover:bg-well md:hidden"
        >
          {open ? <X size={22} weight="light" /> : <List size={22} weight="light" />}
        </button>
      </nav>
      {open && (
        <div id="nav-menu" className="absolute inset-x-0 top-full border-b border-line bg-paper md:hidden">
          <ul className="mx-auto flex w-full max-w-[1120px] flex-col px-4 py-2 sm:px-8">
            {[...LINKS.map((l) => ({ label: l.label, href: href(l.hash), hash: l.hash })), { label: "GitHub", href: GITHUB, hash: "" }].map((l) => (
              <li key={l.label} className="border-b border-line last:border-0">
                <a href={l.href} onClick={() => setOpen(false)} aria-current={current === l.hash ? "true" : undefined} className={`flex min-h-12 items-center text-base ${current === l.hash ? "text-ink underline decoration-crimson decoration-2 underline-offset-8" : "text-ink-2"}`}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  ); // prettier-ignore
}
