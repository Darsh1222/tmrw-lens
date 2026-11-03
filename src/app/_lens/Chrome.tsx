import Link from "next/link";
import { Nav } from "./Nav";

// The frame around every Lens page: a sticky bar with the wordmark, the section
// links, and the one primary action; and a footer that says what this is, what
// it's built on, and how it treats what you add.

export const PITCH =
  "Tomorrow Lens turns the messy paper of student life into a verified plan, and rebuilds it the moment life gets in the way."; // prettier-ignore

export function SiteHeader({ home = false }: { home?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2">
        Skip to content
      </a>
      <div className="relative mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between gap-2 px-4 sm:px-8">
        <Link href="/" className="forum-display shrink-0 text-xl">
          Tomorrow <span className="italic text-crimson">Lens</span>
        </Link>
        <Nav home={home} />
      </div>
    </header>
  ); // prettier-ignore
}

export function SiteFooter() {
  return (
    <footer className="mt-auto">
      <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-8">
        <div className="flex flex-col gap-1" aria-hidden>
          <div className="h-px bg-gilt" />
          <div className="h-px bg-gilt" />
        </div>
        <div className="grid gap-6 py-10 text-sm text-ink-2 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-12">
          <div className="flex flex-col gap-2">
            <p className="forum-display text-lg text-ink">{PITCH}</p>
            <p>Built with Muse Spark 1.3 and SAM 3.1 on Meta Model API · Meta Global AI Developer Hackathon 2026</p>
          </div>
          <div className="flex flex-col gap-2">
            <p>
              Privacy: Standard mode, so nothing you add is used for training. Photos are never stored; what was read
              is cached, encrypted, for 24 hours.
            </p>
            <p className="flex gap-4">
              <Link href="/evals" className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-crimson">
                Evals
              </Link>
              <a href="https://github.com/Darsh1222/tmrw-lens" className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-crimson">
                GitHub
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  ); // prettier-ignore
}
