import Link from "next/link";
import { SiteFooter, SiteHeader } from "./_lens/Chrome";
import { buttonClass } from "./_lens/styles";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-6 px-4 py-24 sm:px-8">
        <h1 className="forum-display text-5xl">Page not found.</h1>
        <p className="text-lg text-ink-2">Check the address, or return to your workspace.</p>
        <Link href="/" className={buttonClass("primary")}>
          Back to Lens
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
