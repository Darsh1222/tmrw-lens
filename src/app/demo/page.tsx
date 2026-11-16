import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "../_lens/Chrome";
import { MissDemo } from "../_lens/MissDemo";
import { buttonClass } from "../_lens/styles";

export const metadata: Metadata = {
  title: "Demo guide · Tomorrow Lens",
  description: "Try the evidence, a conflicting deadline, and a missed-session recovery without an account.",
};

const steps = [
  {
    title: "Inspect a date",
    text: "Open the sample week and select a class or deadline. The evidence panel shows the source words and how the date was computed.",
    href: "/#sample-week",
    action: "Open the sample week",
  },
  {
    title: "Resolve a disagreement",
    text: "The sample quiz has different dates in the syllabus and whiteboard. Compare the sources and answer. A suggested answer waits for your confirmation; Undo last answer reverses it.",
    href: "/#sample-week",
    action: "Compare the sources",
  },
  {
    title: "Take the plan with you",
    text: "Add to calendar downloads confirmed items as an .ics file without an account. Send to Tomorrow needs a connection token from the separate texting assistant.",
    href: "/#sample-week",
    action: "Try calendar export",
  },
];

export default function DemoGuide() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-16 px-4 pb-24 pt-12 sm:px-8">
        <header className="flex max-w-3xl flex-col gap-5">
          <span className="forum-caps">Demo guide · Education</span>
          <h1 className="forum-display text-5xl leading-tight">A deadline you can check. A week you can repair.</h1>
          <p className="text-lg text-ink-2">
            Course information is scattered. Lens turns it into a reviewable plan, asks when sources disagree, and helps
            recover a missed study session.
          </p>
          <p className="text-sm text-ink-2">
            The sample plan and default recovery are recorded, synthetic examples. They need no account or API credits.
            Uploads and custom recovery replies request live AI processing within usage limits.
          </p>
          <a href="#missed-session" className={buttonClass("primary", "self-start")}>
            Try a missed session
          </a>
        </header>
        <ol className="grid gap-5 md:grid-cols-3">
          {steps.map((step, n) => (
            <li key={step.title} className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-6">
              <span className="forum-caps">Step {n + 1}</span>
              <h2 className="forum-display text-2xl">{step.title}</h2>
              <p className="flex-1 text-sm text-ink-2">{step.text}</p>
              <Link href={step.href} className="text-sm underline decoration-crimson underline-offset-4">
                {step.action}
              </Link>
            </li>
          ))}
        </ol>
        <MissDemo />
        <section aria-labelledby="boundaries-title" className="flex max-w-3xl flex-col gap-4">
          <h2 id="boundaries-title" className="forum-display text-3xl">
            What is checked, and what still needs you
          </h2>
          <p className="text-ink-2">
            AI reads and proposes. Code computes dates and checks scheduling constraints. You answer conflicting or
            unclear information. A verification label describes these checks; it does not guarantee correctness.
          </p>
          <p className="text-ink-2">
            Current evaluation evidence is synthetic. It does not establish improved grades, lower stress, or accuracy
            across real student documents. The next step is consented testing of correction effort and recovery
            usefulness.
          </p>
          <Link href="/evals" className="self-start underline decoration-crimson underline-offset-4">
            Inspect the evaluation and its limits
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
