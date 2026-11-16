import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../_lens/Chrome";
import { Workspace } from "./Workspace";
export const metadata: Metadata = {
  title: "Recover your week · Tomorrow Lens",
  description: "Compare complete recovery plans, protect commitments, and learn from the effort you actually record.",
};
export default function RecoveryPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-12 px-4 pb-24 pt-12 sm:px-8">
        <header className="flex max-w-3xl flex-col gap-4">
          <span className="forum-caps">Tomorrow Lens · Recovery workspace</span>
          <h1 className="forum-display text-5xl leading-tight sm:text-6xl">Make the next step fit your life.</h1>
          <p className="text-lg text-ink-2">Name the obstacle. Compare the trade-offs. Keep control of what changes.</p>
          <p className="text-sm text-ink-2">
            This workspace computes plans locally using explicit rules. It does not use a language model or send texts.
            The source reader and original rebuild agent still use Meta models.
          </p>
        </header>
        <Workspace />
      </main>
      <SiteFooter />
    </>
  );
}
