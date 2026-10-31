import { Lens } from "./_lens/Lens";

export default function Home() {
  return (
    <>
      <Lens />
      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-text-secondary">
        Built for the Meta Global AI Developer Hackathon (Oct 27 to Nov 4, 2026), solo with AI coding assistance. Uses
        Muse Spark and SAM 3.1 on Meta Model API.{" "}
        <a className="underline" href="https://github.com/Darsh1222/tmrw-lens">
          Source
        </a>
        .
      </footer>
    </>
  );
}
