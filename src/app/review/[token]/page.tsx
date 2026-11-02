import type { Metadata } from "next";
import { Suspense } from "react";
import { readEnv } from "@/lib/env";
import { formatTime } from "@/lib/plan/merge";
import { formatDate } from "@/lib/resolve/dates";
import { kvFor } from "@/lib/server/kv";
import { reviewStore } from "@/lib/server/review";
import { assemble, type ExtractResponse, type ExtractState } from "@/lib/tomorrow/extract";
import { Badge } from "../../_lens/ui";

// The review link in a text-a-photo response: what Lens read from the photo,
// what's ready to add, what it would change, and what it needs to ask. The
// link holds the key to what was read; it lasts 24 hours. Answers go by
// replying to Tomorrow's text. Not indexed, and the link isn't sent as a
// referrer to anywhere this page links.

export const metadata: Metadata = {
  title: "Review · Tomorrow Lens",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const when = (date: string | null, time: string | null) =>
  date ? `${formatDate(date)}${time ? `, ${formatTime(time)}` : ""}` : "no date yet";

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">What Lens read from your photo</h1>
      <Suspense fallback={<p className="text-text-secondary">Loading…</p>}>
        {params.then(({ token }) => (
          <Review token={decodeURIComponent(token)} />
        ))}
      </Suspense>
    </main>
  );
}

async function Review({ token }: { token: string }) {
  const env = readEnv();
  const loaded = env.LENS_REBUILD_SECRET
    ? await reviewStore(kvFor(env), env.LENS_REBUILD_SECRET).load<ExtractState>(token)
    : null;
  if (!loaded)
    return (
      <p className="text-text-secondary">
        This link has expired (they last 24 hours) or isn&apos;t valid. Text the photo to Tomorrow again for a new one.
      </p>
    );
  const r: ExtractResponse = assemble(loaded.value, { url: `${env.LENS_PUBLIC_URL}/review/${token}`, expires_at: loaded.expires_at }); // prettier-ignore
  const ready = r.items.filter((i) => i.auto_apply);
  const waiting = r.items.filter((i) => !i.auto_apply);
  return (
    <div className="flex flex-col gap-5">
      <p>{r.summary}</p>

      {ready.length > 0 && (
        <Section title={`Ready to add (${ready.length})`}>
          {ready.map((i) => (
            <Row key={i.lens_id} item={i} />
          ))}
        </Section>
      )}
      {r.changes.length > 0 && (
        <Section title="Changes to something already in your plan">
          {r.changes.map((c) => (
            <li key={c.existing_id} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{c.title}</div>
              <div>
                <s className="text-text-secondary">{when(c.from.date, c.from.time)}</s> →{" "}
                <span className="font-medium">{when(c.to.date, c.to.time)}</span>{" "}
                <span className="text-text-secondary">
                  {c.status === "confirmed"
                    ? "· you confirmed it"
                    : c.status === "kept"
                      ? "· you kept the old one"
                      : "· waiting for your answer"}{" "}
                  {/* prettier-ignore */}
                </span>
              </div>
              <blockquote className="mt-1 text-xs italic text-text-secondary">
                From the {c.evidence.source}: “{c.evidence.quote}”
              </blockquote>
            </li>
          ))}
        </Section>
      )}
      {waiting.length > 0 && (
        <Section title="Read, but not added until you answer">
          {waiting.map((i) => (
            <Row key={i.lens_id} item={i} />
          ))}
        </Section>
      )}
      {r.questions.length > 0 && (
        <Section title="Questions">
          {r.questions.map((q) => (
            <li key={q.id} className="rounded-lg border border-border p-3 text-sm">
              <p>{q.text}</p>
              <ul className="mt-1 list-disc pl-5 text-text-secondary">
                {q.options.map((o) => (
                  <li key={o.id}>
                    {o.label}
                    {o.id === q.suggested && (
                      <span className="text-accent"> (suggested{q.why ? `: ${q.why}` : ""})</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </Section>
      )}
      {r.duplicates.length > 0 && (
        <p className="text-sm text-text-secondary">
          {r.duplicates.length} {r.duplicates.length === 1 ? "thing was" : "things were"} already in your plan with the
          same date, so nothing changes for {r.duplicates.length === 1 ? "it" : "them"}.
        </p>
      )}
      <p className="text-xs text-text-secondary">
        Answer by replying to Tomorrow&apos;s text. Lens didn&apos;t keep your photo, only what it read from it, and
        this link stops working {new Date(loaded.expires_at).toUTCString().replace(" GMT", " UTC")}.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function Row({ item: i }: { item: ExtractResponse["items"][number] }) {
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{i.title}</span>
        <Badge status={i.status} />
      </div>
      <div className="text-text-secondary">
        {i.kind === "class_block" ? `weekly, from ${i.start.slice(0, 10)}` : when(i.date, i.start_time)}
        {i.course ? ` · ${i.course}` : ""}
      </div>
      <blockquote className="mt-1 text-xs italic text-text-secondary">
        From the {i.evidence[0].source}: “{i.evidence[0].quote.replace(/\s+/g, " ")}”
        {i.evidence[0].computed_from ? ` · ${i.evidence[0].computed_from}` : ""}
      </blockquote>
    </li>
  );
}
