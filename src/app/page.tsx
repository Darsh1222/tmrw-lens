import { SiteFooter, SiteHeader } from "./_lens/Chrome";
import { HomeWorkspace } from "./_workspace/HomeWorkspace";

export default function Home() {
  return (
    <>
      <SiteHeader home />
      <main id="main" className="lens-main">
        <HomeWorkspace />
      </main>
      <SiteFooter />
    </>
  );
}
