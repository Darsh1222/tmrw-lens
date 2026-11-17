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
      <div className="relative mx-auto flex h-16 w-full max-w-[1360px] items-center justify-between gap-2 px-4 sm:px-8">
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
    <footer className="lens-footer">
      <div>
        <p className="forum-display">Tomorrow Lens</p>
        <span>A plan you can check. Room to change.</span>
      </div>
      <nav aria-label="Footer">
        <Link href="/#workspace">Your week</Link>
        <Link href="/evals">Evaluations</Link>
        <a href="https://github.com/Darsh1222/tmrw-lens">Source code</a>
        <details>
          <summary>Data & privacy</summary>
          <p>
            The planner runs in your browser. Course uploads use the AI reader. Remembering a task on this device is
            optional. Source reading uses Muse Spark and SAM 3.1.
          </p>
        </details>
      </nav>
    </footer>
  );
}
