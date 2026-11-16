import { SiteFooter, SiteHeader } from "../../_lens/Chrome";
import { Workspace } from "../Workspace";
export default function DetailedRecovery() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-10 px-4 py-12 sm:px-8">
        <header>
          <p className="forum-caps">Detailed planner</p>
          <h1 className="forum-display mt-3 text-4xl">All your planning controls</h1>
          <a href="/recover" className="mt-4 inline-block text-sm underline underline-offset-4">
            Back to the simple planner
          </a>
        </header>
        <Workspace />
      </main>
      <SiteFooter />
    </>
  );
}
