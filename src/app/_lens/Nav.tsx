"use client";
import Link from "next/link";
import { List, X, ArrowUpRight } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { buttonClass } from "./styles";

export function Nav({ home }: { home: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const plan = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (home) {
      event.preventDefault();
      window.dispatchEvent(new Event("lens:plan-task"));
      document.getElementById("workspace")?.scrollIntoView({ block: "start" });
    }
    setOpen(false);
  };
  return (
    <>
      <nav aria-label="Main" className="flex items-center gap-2 sm:gap-5">
        <Link
          className="hidden min-h-11 items-center text-sm text-ink-2 transition-colors hover:text-ink md:inline-flex"
          href="/#how"
        >
          How it works
        </Link>
        <Link
          className="hidden min-h-11 items-center text-sm text-ink-2 transition-colors hover:text-ink md:inline-flex"
          href="/evals"
        >
          How we check
        </Link>
        <Link href="/?intent=task" onClick={plan} className={buttonClass("primary", "rounded-full px-4 sm:px-5")}>
          Plan a task
          <ArrowUpRight size={15} />
        </Link>
        <button
          className="grid h-11 w-10 place-items-center rounded-full text-ink md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="nav-menu"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={21} /> : <List size={21} />}
        </button>
      </nav>
      {open && (
        <div
          id="nav-menu"
          className="absolute left-4 right-4 top-[70px] z-50 flex flex-col gap-1 rounded-2xl border border-line bg-card p-3 shadow-lg md:hidden"
        >
          <Link
            href="/?tab=week"
            onClick={(event) => {
              if (home) {
                event.preventDefault();
                window.dispatchEvent(new CustomEvent("lens:navigate", { detail: "week" }));
              }
              setOpen(false);
            }}
            className="rounded-lg p-3 text-sm"
          >
            Your week
          </Link>
          <Link
            href="/?tab=sources"
            onClick={(event) => {
              if (home) {
                event.preventDefault();
                window.dispatchEvent(new CustomEvent("lens:navigate", { detail: "sources" }));
              }
              setOpen(false);
            }}
            className="rounded-lg p-3 text-sm"
          >
            Course material
          </Link>
          <Link href="/#how" onClick={() => setOpen(false)} className="rounded-lg p-3 text-sm">
            How it works
          </Link>
          <Link href="/evals" onClick={() => setOpen(false)} className="rounded-lg p-3 text-sm">
            How we check
          </Link>
        </div>
      )}
    </>
  );
}
