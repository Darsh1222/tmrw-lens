import { SiteFooter, SiteHeader } from "./_lens/Chrome";
import { Hero } from "./_lens/Hero";
import { Lens } from "./_lens/Lens";
import { MissDemo } from "./_lens/MissDemo";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-20 px-4 pb-24 sm:gap-28 sm:px-8">
        <Hero />
        <Lens />
        <MissDemo />
      </main>
      <SiteFooter />
    </>
  );
}
