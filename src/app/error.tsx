"use client";

import Link from "next/link";
import { buttonClass } from "./_lens/styles";

// Shown if a page fails to render. Says so plainly and offers a way back.

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-6 px-4 py-24 sm:px-8">
      <span className="forum-caps">Something went wrong</span>
      <h1 className="forum-display text-5xl">This page didn&apos;t load.</h1>
      <p className="text-lg text-ink-2">Nothing you added was sent anywhere because of it. Try again.</p>
      <div className="flex gap-3">
        <button onClick={reset} className={buttonClass("primary")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("quiet")}>
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
