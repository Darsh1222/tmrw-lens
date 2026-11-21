import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "../_lens/Chrome";
import { MissDemo } from "../_lens/MissDemo";
import { buttonClass } from "../_lens/styles";

export const metadata: Metadata = {
  title: "How Lens works · Tomorrow Lens",
  description: "Check a deadline, preview study time, and recover unfinished work without restarting your progress.",
};
const steps = [
  {
    title: "Check a deadline",
    text: "Open the sample course material and select a date. Inspect the source text. If two sources disagree, confirm the right date before using it.",
    href: "/#sample-week",
    action: "Try source checking",
  },
  {
    title: "Preview a study plan",
    text: "Open the example plan. It starts with ten minutes and accounts for all the work left. The schedule is a preview until you choose Use this plan.",
    href: "/?tab=week&example=stuck&view=plan",
    action: "Open the example plan",
  },
  {
    title: "Recover without restarting",
    text: "Apply the example plan, mark the ten-minute step finished, then choose Plans changed. Lens replans the remaining fifty minutes and keeps the ten you finished.",
    href: "/?tab=week&example=stuck&view=plan",
    action: "Try the recovery example",
  },
];
export default function DemoGuide() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-10 px-4 pb-16 pt-8 sm:px-8">
        <header className="flex max-w-3xl flex-col gap-4">
          <h1 className="text-3xl font-medium leading-tight">From a deadline to a next step.</h1>
          <p className="text-lg text-ink-2">
            Check the source, find study time, and adjust unfinished work when plans change.
          </p>
          <p className="text-sm leading-relaxed text-ink-2">
            The examples use made-up course data and need no account or API credits. The web planner runs locally in
            your browser. Reading new course documents and photos uses the configured AI service; calendar files are
            read directly.
          </p>
          <Link href="/?tab=week&example=stuck&view=plan" className={buttonClass("primary", "self-start")}>
            Try the example plan
          </Link>
        </header>
        <ol className="grid gap-5 md:grid-cols-3" aria-label="Try the full Lens workflow">
          {steps.map((step, n) => (
            <li key={step.title} className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5">
              <h2 className="text-xl font-medium">
                {n + 1}. {step.title}
              </h2>
              <p className="flex-1 text-sm leading-relaxed text-ink-2">{step.text}</p>
              <Link href={step.href} className="text-sm underline decoration-crimson underline-offset-4">
                {step.action}
              </Link>
            </li>
          ))}
        </ol>
        <section className="flex max-w-3xl flex-col gap-3" aria-labelledby="your-work-title">
          <h2 id="your-work-title" className="text-xl font-medium">
            Use it for your own work
          </h2>
          <p className="text-ink-2">
            Choose Course material to add files and review dates. Save the reviewed schedule, then choose Your week to
            add tasks around classes, existing work and available hours. You can export confirmed dates or remaining
            study sessions as a calendar file.
          </p>
          <p className="text-sm text-ink-2">
            Lens keeps your reviewed schedule and approved tasks on this device. Add another task without replacing
            earlier work. Calendar downloads do not update existing external events.
          </p>
          <Link href="/?tab=sources" className="self-start text-sm underline underline-offset-4">
            Add course material
          </Link>
        </section>
        <section aria-labelledby="assistant-title" className="flex flex-col gap-4 border-t border-line pt-8">
          <h2 id="assistant-title" className="text-xl font-medium">
            Optional: see the texting assistant demo
          </h2>
          <p className="max-w-3xl text-sm leading-relaxed text-ink-2">
            This recorded demo shows the separate Tomorrow assistant using AI tools to recover a missed session. It is
            different from the local web planner above. Default replies play recorded runs; custom replies request live
            AI processing.
          </p>
          <MissDemo />
        </section>
        <section aria-labelledby="boundaries-title" className="flex max-w-3xl flex-col gap-3 border-t border-line pt-8">
          <h2 id="boundaries-title" className="text-xl font-medium">
            What the checks mean
          </h2>
          <p className="text-ink-2">
            AI reads course information. Code checks source evidence, dates and scheduling constraints. You resolve
            unclear information and approve changes. A verified label describes those checks; it is not a guarantee that
            a source or reading is correct.
          </p>
          <p className="text-sm text-ink-2">
            Current evaluations use synthetic data and recorded model outputs. Student testing is still needed to
            measure whether Lens saves time or makes recovery easier.
          </p>
          <Link href="/evals" className="self-start text-sm underline underline-offset-4">
            View test results and their limits
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
