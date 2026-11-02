import Link from "next/link";
import { SiteFooter, SiteHeader } from "./_lens/Chrome";
import { buttonClass } from "./_lens/styles";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-6 px-4 py-24 sm:px-8">
        <span className="forum-caps">Not found</span>
        <h1 className="forum-display text-5xl">There&apos;s nothing at this address.</h1>
        <p className="text-lg text-ink-2">It may have moved, or a review link may have expired; they last a day.</p>
        <Link href="/" className={buttonClass("primary")}>
          Go to the home page
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
