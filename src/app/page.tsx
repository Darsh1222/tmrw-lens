import { SiteFooter, SiteHeader } from "./_lens/Chrome";
import { Hero } from "./_lens/Hero";
import { HowTo } from "./_lens/HowTo";
import { Lens } from "./_lens/Lens";
import { MissDemo } from "./_lens/MissDemo";
import { Results } from "./_lens/Results";

// The home page, in the order a first-time visitor needs it: what it is, how to try it, then I · Read (upload or the
// sample), II · Prove (the plan and its proof), III · Rebuild (a missed session), IV · Results.

export default function Home() {
  return (
    <>
      <SiteHeader home />
      <main
        id="main"
        className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-24 px-4 pb-24 sm:gap-32 sm:px-8"
      >
        <div className="flex flex-col gap-16">
          <Hero />
          <HowTo />
        </div>
        <Lens />
        <MissDemo />
        <Results />
      </main>
      <SiteFooter />
    </>
  );
}
