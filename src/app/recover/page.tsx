import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../_lens/Chrome";
import { SimpleRecovery } from "./SimpleRecovery";
export const metadata: Metadata = {
  title: "Recover your week · Tomorrow Lens",
  description: "Compare complete recovery plans, protect commitments, and learn from the effort you actually record.",
};
export default function RecoveryPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-[960px] flex-1 flex-col gap-12 px-4 pb-24 pt-12 sm:px-8">
        <header className="flex max-w-3xl flex-col gap-4">
          <span className="forum-caps">Tomorrow Lens</span>
          <h1 className="forum-display text-5xl leading-tight sm:text-6xl">Let’s make room for it.</h1>
          <p className="text-lg text-ink-2">One task. A few simple choices. A plan you can change.</p>
        </header>
        <SimpleRecovery />
      </main>
      <SiteFooter />
    </>
  );
}
