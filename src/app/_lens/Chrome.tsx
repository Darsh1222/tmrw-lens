import Link from "next/link";

// The frame around every Lens page: a quiet header with the wordmark and
// three links, and a footer that says what this is and what it's built on.

export function SiteHeader() {
  return (
    <header className="border-b border-line">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <Link href="/" className="forum-display text-xl">
          Tomorrow <span className="italic text-crimson">Lens</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <Link href="/#missed-session" className="hidden min-h-11 items-center rounded-lg px-3 text-ink-2 hover:text-ink sm:inline-flex">
            The rebuild
          </Link>
          <Link href="/evals" className="inline-flex min-h-11 items-center rounded-lg px-3 text-ink-2 hover:text-ink">
            Evals
          </Link>
          <a href="https://github.com/Darsh1222/tmrw-lens" className="inline-flex min-h-11 items-center rounded-lg px-3 text-ink-2 hover:text-ink">
            Source
          </a>
        </nav>
      </div>
    </header>
  ); // prettier-ignore
}

export function SiteFooter() {
  return (
    <footer className="mt-auto">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
        <div className="flex flex-col gap-1" aria-hidden>
          <div className="h-px bg-gilt" />
          <div className="h-px bg-gilt" />
        </div>
        <div className="flex flex-col gap-3 py-10 text-sm text-ink-2 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-xl">
            Built for the Meta Global AI Developer Hackathon (Oct 27 to Nov 4, 2026), solo with AI coding assistance.
            Reads with Muse Spark and SAM 3.1 on Meta Model API, in Standard mode: nothing you add is used for training.
          </p>
          <div className="flex gap-4">
            <Link href="/evals" className="hover:text-ink">
              Evals
            </Link>
            <a href="https://github.com/Darsh1222/tmrw-lens" className="hover:text-ink">
              Source
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
