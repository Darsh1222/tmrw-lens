import type { Metadata } from "next";
import extraction from "../../../evals/results.json";
import extract from "../../../evals/extract/results.json";
import rebuild from "../../../evals/rebuild/results.json";
import { SiteFooter, SiteHeader } from "../_lens/Chrome";

// How Lens is measured, from the eval results in the repo (the same files CI
// replays). Everything here is synthetic: made-up schedules, syllabi, photos.

export const metadata: Metadata = {
  title: "Evals · Tomorrow Lens",
  description: "How Lens is measured: verification, invented dates, rebuilds, and text-a-photo, with cost per call.",
};

const x = extraction.headline;
const sam = x.with_sam;
const box = x.without_sam;
const money = (n: number) => `$${n.toFixed(4)}`;

function Figure({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-4">
      <span className="forum-display text-4xl sm:text-5xl">{value}</span>
      <span className="text-sm text-ink">{label}</span>
      {note && <span className="text-xs text-ink-2">{note}</span>}
    </div>
  );
}

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-well">
            {head.map((h, n) => (
              <th key={n} scope="col" className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => (
            <tr key={n} className="border-t border-line">
              {r.map((c, k) =>
                k === 0 ? (
                  <th key={k} scope="row" className="px-4 py-3 font-normal text-ink-2">
                    {c}
                  </th>
                ) : (
                  <td key={k} className="px-4 py-3">
                    {c}
                  </td>
                ),
              )}{" "}
              {/* prettier-ignore */}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  n,
  title,
  intro,
  children,
}: {
  n: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="forum-caps">{n}</span>
        <h2 className="forum-display text-3xl">{title}</h2>
        <p className="max-w-2xl text-ink-2">{intro}</p>
      </div>
      {children}
    </section>
  );
}

export default function Evals() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-20 px-4 pb-24 pt-12 sm:px-8 sm:pt-16">
        <header className="flex max-w-3xl flex-col gap-4">
          <span className="forum-caps">Evals</span>
          <h1 className="forum-display text-5xl leading-[1.05] sm:text-6xl">
            Every date traces to the <em className="text-crimson">words</em> it came from.
          </h1>
          <p className="text-lg text-ink-2">
            Lens is scored on made-up schedules, syllabi, whiteboards, and notes, with deliberate conflicts. Recorded
            model readings replay in CI on every push, so these numbers can&apos;t quietly get worse.
          </p>
        </header>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <Figure value={sam.invented_dates.split(" ")[0]} label="Invented dates" note={`of ${sam.invented_dates.split(" of ")[1]} audited`} />
          <Figure value={sam.fully_verified.match(/\((.+)\)/)?.[1] ?? sam.fully_verified} label="Fully verified on first read" note="The rest are real questions, asked once" /> {/* prettier-ignore */}
          <Figure value={`${Math.round(rebuild.headline.hard_rules * 100)}%`} label="Rebuilds that keep every rule" note={`${rebuild.headline.cases} cases, ${rebuild.headline.runs_per_case} runs each`} /> {/* prettier-ignore */}
          <Figure value={extract.headline.precision.replace(".0", "")} label="Text-a-photo precision" note={`Recall ${extract.headline.recall.replace(".0", "")}`} /> {/* prettier-ignore */}
        </div>

        <Section n="I · Read" title="Reading and verifying" intro={`${x.cases} cases over synthetic fixtures. Each photo is read once, then checked a second way: on SAM 3.1's crop of the object it's written on, and on a plain box crop, so the two columns differ only in SAM.`}> {/* prettier-ignore */}
          <Table
            caption="Reading, with and without SAM"
            head={["", "With SAM 3.1", "Without SAM"]}
            rows={[
              ["Fully verified", sam.fully_verified, box.fully_verified],
              ["Invented dates", sam.invented_dates, box.invented_dates],
              ["Items found", sam.items_found, box.items_found],
              ["Classes right", sam.classes_right, box.classes_right],
              ["Dates right", sam.dates_right, box.dates_right],
              ["Conflicts caught", sam.conflicts_caught, box.conflicts_caught],
              ["Right answer pre-selected", sam.conflict_answer_preselected_right, box.conflict_answer_preselected_right],
              ["Photo quotes in a SAM object", sam.photo_quotes_in_an_object, box.photo_quotes_in_an_object],
              ["Model cost per photo", money(x.cost.sam_per_photo), money(x.cost.box_per_photo)],
            ]}
          />
          <p className="text-sm text-ink-2">Tokens per call {x.cost.tokens_per_call}; prompt cache hit rate {x.cost.cache_hit_rate}.</p>
        </Section>

        <Section n="II · Rebuild" title="When a session is missed" intro={`${rebuild.headline.cases} weeks where a planned session passes undone, each run ${rebuild.headline.runs_per_case} times: too tired tonight, sick, did half, a heavy day, the clock change, a deadline moved, no time left, a reply that tries to give orders. Code checks every rule in every run, and ranks every slot to say where the session should have gone.`}> {/* prettier-ignore */}
          <Table
            caption="Rebuild agent against code alone"
            head={["", "Muse Spark agent", "Code alone"]}
            rows={[
              ["Cases passed (all runs)", rebuild.headline.cases_passed, rebuild.headline.fallback_cases_passed],
              ["Runs that keep every hard rule", `${(rebuild.headline.hard_rules * 100).toFixed(0)}%`, `${(rebuild.headline.fallback_hard_rules * 100).toFixed(0)}%`], // prettier-ignore
              ["Placed in code's best slot (top 1 / top 3)", `${(rebuild.headline.top1 * 100).toFixed(0)}% / ${(rebuild.headline.top3 * 100).toFixed(0)}%`, "–"], // prettier-ignore
              ["Unkind messages", rebuild.headline.unkind_messages, 0],
              ["Judge score (1 to 5)", (rebuild.headline.judge_score ?? 0).toFixed(1), "–"],
              ["Model cost per rebuild", money(rebuild.headline.cost_per_rebuild), "free"],
              ["Turns per rebuild", rebuild.headline.turns_per_rebuild, "–"],
            ]}
          />
          <p className="text-sm text-ink-2">Tokens per call {rebuild.headline.tokens_per_call}; prompt cache hit rate {rebuild.headline.cache_hit_rate}.</p>
        </Section>

        <Section n="III · Text a photo" title="Photos texted to Tomorrow" intro="A whiteboard that moves a syllabus quiz, a course site's to-do list (alone, and against items already planned), and a photo too blurry to trust.">
          <Table
            caption="Text-a-photo"
            head={["", "Result"]}
            rows={[
              ["Auto-applied and right", extract.headline.auto_applied_right],
              ["Precision", extract.headline.precision],
              ["Recall", extract.headline.recall],
              ["Invented dates", extract.headline.invented_dates],
              ["Changes caught", extract.headline.changes_caught],
              ["Changes applied before an answer", extract.headline.changes_applied_before_answer],
              ["Duplicates recognized", extract.headline.duplicates_recognized],
              ["Model cost per photo", money(extract.headline.cost_per_photo)],
            ]}
          />
        </Section>
      </main>
      <SiteFooter />
    </>
  ); // prettier-ignore
}
