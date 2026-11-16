import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../_lens/Chrome";
import { SimpleRecovery } from "./SimpleRecovery";
export const metadata: Metadata = {
  title: "Your next step · Tomorrow Lens",
  description: "One next step, its deadline source, and a complete plan for unfinished work.",
};
export default function RecoveryPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-[960px] flex-1 flex-col gap-8 px-4 pb-24 pt-8 sm:px-8">
        <header className="flex max-w-3xl flex-col gap-4">
          <span className="forum-caps">Tomorrow Lens</span>
          <h1 className="forum-display text-4xl leading-tight sm:text-5xl">One thing at a time.</h1>
          <p className="text-lg text-ink-2">Keep the next step clear when your week changes.</p>
        </header>
        <SimpleRecovery />
      </main>
      <SiteFooter />
    </>
  );
}
