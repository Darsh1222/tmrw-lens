"use client";

import { DateTime } from "luxon";
import { Reveal } from "./Reveal";
import { swarm } from "./swarm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import sample from "@/lib/demo/sample-week.json";
import { useStored, writeStored } from "./stored";
import type { Answer } from "@/lib/plan/answer";
import { planFrom } from "@/lib/plan/session";
import type { PageReading, SourceReading } from "@/lib/plan/types";
import type { SourceKind } from "@/lib/schemas/evidence";
import { EvidenceDrawer } from "./plan/EvidenceDrawer";
import { SemesterView, WeekView } from "./plan/PlanViews";
import { guessKind, KIND_LABEL, prepare, usableText } from "./prepare";
import { QuestionCard } from "./QuestionCard";
import { SendPanel } from "./SendPanel";
import { metaOf, type Input } from "./types";
import { Upload } from "./Upload";
import { seenWait, useReducedMotion, useSeen } from "./useSeen";
import { buttonClass, Chip, money, palette, Swatch } from "./ui";
import { Viewer, type Mark } from "./Viewer";

// The whole Lens flow on one page: add inputs, read them, watch what was read
// get outlined on the source, see the plan with every item's proof one tap
// away, answer one question at a time, send to Tomorrow. The page holds
// everything (inputs, readings, answers); the plan is recomputed from them on
// every change, so nothing about a visitor lives on the server.

/** Set once the "Tap any item" hint is dismissed. */
const HINT = "lens_hint_proof";
const SAMPLE = sample as unknown as { zone: string; files: string[]; readings: SourceReading[] };
/** Pages in flight at once, across every file: enough that a 10-page PDF reads in about one page's time. */
const CONCURRENCY = 8;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (inFlight >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await f();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
const newId = () => Math.random().toString(36).slice(2, 8);

function labelled(inputs: Input[], base: string): string {
  const n = inputs.filter((i) => i.label === base || i.label.startsWith(`${base} `)).length;
  return n ? `${base} ${n + 1}` : base;
}

export function Lens() {
  const [inputs, setInputs] = useState<Input[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [zone, setZone] = useState<string>("America/New_York");
  const [selected, setSelected] = useState<string | null>(null);
  const [at, setAt] = useState<{ input: string; page: number }>({ input: "", page: 0 });
  const [later, setLater] = useState<string[]>([]);
  const [error, setError] = useState<{ q: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [view, setView] = useState<"week" | "semester">("week");
  // The SAM moment: outlines draw on the source, then the cards arrive. "waiting" hides the cards until then.
  const [reveal, setReveal] = useState(0);
  const [arrival, setArrival] = useState<"waiting" | "arriving" | "done">("done");
  const results = useRef<HTMLDivElement>(null);
  // From the click that starts a read until the plan exists: the results area holds a screen's height, so what
  // arrives fills it instead of pushing the page below it around.
  const [loading, setLoading] = useState(false);

  const update = (id: string, f: (i: Input) => Input) => setInputs((xs) => xs.map((x) => (x.id === id ? f(x) : x)));

  const readings: SourceReading[] = useMemo(
    () =>
      inputs
        // Each page joins the plan as soon as it's read: a 10-page PDF shows its first page's items in seconds.
        .filter((i) => (i.status === "read" || i.status === "reading") && i.readings.some(Boolean))
        .map((i) => ({ source: metaOf(i), pages: i.readings.filter((r): r is PageReading => r !== null) })),
    [inputs],
  );
  const session = useMemo(() => (readings.length ? planFrom(readings, { zone, answers }) : null), [readings, zone, answers]); // prettier-ignore
  const plan = session?.plan ?? null;

  /** A card for an input that's still opening: final size from the start, so nothing moves when it fills in. */
  const opening = (id: string, name: string, kind: SourceKind, label: string, added_at: string, recorded: boolean): Input => ({
    id, name, kind, label, captured_at: null, added_at, pages: [], readings: [], status: "opening",
    done: 0, error: null, note: null, cost_usd: 0, recorded,
  }); // prettier-ignore

  async function add(files: FileList | File[]) {
    const list = Array.from(files);
    const now = DateTime.now().setZone(zone).toISO()!;
    const ids = list.map(() => newId());
    if (inputs.some((i) => i.recorded)) setAnswers([]);
    setZone(browserZone());
    setBusy(null);
    setInputs((xs) => {
      const base = xs.filter((x) => !x.recorded);
      return [
        ...base,
        ...list.map((f, n) => {
          const kind = guessKind(f.name, f.type);
          return opening(ids[n], f.name, kind, labelled(base, KIND_LABEL[kind]), now, false);
        }),
      ];
    });
    for (const [n, file] of list.entries()) {
      try {
        const p = await prepare(file, file.name);
        const taken = p.takenAt ? DateTime.fromISO(p.takenAt, { zone: browserZone(), setZone: /[+-]\d{2}:\d{2}$/.test(p.takenAt) }).toISO() : null; // prettier-ignore
        update(ids[n], (x) => {
          const kindLabel = KIND_LABEL[x.kind];
          return {
            ...x,
            kind: p.kind,
            label: x.label.startsWith(kindLabel) ? x.label.replace(kindLabel, p.label) : x.label,
            captured_at: p.kind === "whiteboard_photo" || p.kind === "notes_photo" ? taken : null,
            pages: p.pages,
            // A calendar file is read in code already; everything else is read now, without waiting for a click.
            readings: p.readings ?? p.pages.map(() => null),
            done: p.readings ? p.pages.length : 0,
            status: p.readings ? "read" : "ready",
            note: p.note,
          };
        });
        if (!p.readings) void readInputs([{ id: ids[n], kind: p.kind, pages: p.pages }]);
      } catch (e) {
        setInputs((xs) => xs.filter((x) => x.id !== ids[n]));
        setBusy(
          `Couldn't open ${file.name}: ${e instanceof Error ? e.message : "it isn't a PDF, photo, or text file."}`,
        );
      }
    }
  }

  async function addPaste(text: string) {
    if (!text.trim()) return;
    await add([new File([text], "testudo.txt", { type: "text/plain" })]);
  }

  const remove = (id: string) => setInputs((xs) => xs.filter((x) => x.id !== id));

  /** A photo read as the wrong kind: change it and it's read again as that kind. */
  function setKind(id: string, kind: SourceKind) {
    const i = inputs.find((x) => x.id === id);
    if (!i) return;
    const next: Input = {
      ...i,
      kind,
      label: KIND_LABEL[kind],
      captured_at: kind === "whiteboard_photo" || kind === "notes_photo" ? i.captured_at : null,
    };
    update(id, () => next);
    if (i.status !== "opening" && i.status !== "reading") void readInputs([next]);
  }

  /** Read these inputs' pages, all at once up to the shared limit. Each page joins the plan the moment it's back. */
  async function readInputs(todo: Pick<Input, "id" | "kind" | "pages">[]) {
    if (!todo.length) return;
    setLoading(true);
    const jobs = todo.flatMap((i) => i.pages.map((p, n) => ({ input: i, page: p, n })));
    for (const i of todo)
      update(i.id, (x) => ({ ...x, status: "reading", error: null, done: 0, readings: x.pages.map(() => null), startedAt: Date.now() })); // prettier-ignore
    const failed = new Set<string>();
    await Promise.all(
      jobs.map(({ input, page, n }) =>
        slot(async () => {
          if (failed.has(input.id)) return;
          const form = new FormData();
          form.set("meta", JSON.stringify({ kind: input.kind, page: page.page }));
          // A page with real text goes as text alone (one fast text read, no vision); otherwise the picture.
          const photo = input.kind === "whiteboard_photo" || input.kind === "notes_photo" || input.kind === "testudo_screenshot"; // prettier-ignore
          if (!photo && usableText(page.text)) form.set("text", page.text!);
          else if (page.blob) form.set("image", page.blob, "page");
          else if (page.text) form.set("text", page.text);
          const res = await fetch("/api/read", { method: "POST", body: form }).catch(() => null);
          const body = res ? await res.json().catch(() => null) : null;
          if (!res?.ok || !body?.page) {
            failed.add(input.id);
            update(input.id, (x) => ({ ...x, status: "error", error: body?.error ?? "Couldn't reach Lens. Check your connection and try again." })); // prettier-ignore
            return;
          }
          update(input.id, (x) => {
            if (x.status === "error") return x;
            const readings = x.readings.map((r, k) => (k === n ? (body.page as PageReading) : r));
            const done = readings.filter(Boolean).length;
            return { ...x, readings, done, cost_usd: x.cost_usd + (body.cost_usd ?? 0), status: done === x.pages.length ? "read" : "reading" }; // prettier-ignore
          });
        }),
      ),
    );
    setLoading(false);
    const photo = todo.find((i) => (i.kind === "whiteboard_photo" || i.kind === "notes_photo") && !failed.has(i.id)); // prettier-ignore
    if (photo) setAt({ input: photo.id, page: 0 });
  }

  /** "Try again": whatever didn't read. */
  const readAll = () => readInputs(inputs.filter((i) => i.status === "ready" || i.status === "error"));

  async function trySample() {
    setBusy("Opening the sample week…");
    setLoading(true);
    setAnswers([]);
    setSelected(null);
    setLater([]);
    setZone(SAMPLE.zone);
    // Cards first, at their final size; they all flip to read together once the files are open.
    setInputs(SAMPLE.readings.map((r, k) => opening(r.source.id, SAMPLE.files[k], r.source.kind, r.source.label, r.source.added_at, true))); // prettier-ignore
    try {
      const out: Input[] = [];
      for (const [k, r] of SAMPLE.readings.entries()) {
        const blob = await (await fetch(SAMPLE.files[k])).blob();
        const p = await prepare(blob, SAMPLE.files[k], r.source.kind);
        out.push({
          id: r.source.id,
          name: SAMPLE.files[k],
          kind: r.source.kind,
          label: r.source.label,
          captured_at: r.source.captured_at,
          added_at: r.source.added_at,
          pages: p.pages,
          readings: r.pages,
          status: "read",
          done: r.pages.length,
          error: null,
          note: null,
          cost_usd: 0,
          recorded: true,
        });
      }
      setInputs(out);
      // Open on a photo with SAM objects: the outlines drawing on is the first thing to see.
      const photo = out.find((i) => i.readings.some((r) => r?.objects?.length)) ?? out[0];
      setAt({ input: photo.id, page: 0 });
    } finally {
      setBusy(null);
      setLoading(false);
    }
  }

  // "Try the sample week" at the top of the page links to #sample-week: open it straight away.
  const sampleLatest = useRef<() => void>(() => {});
  useEffect(() => {
    sampleLatest.current = () => void trySample();
  });
  useEffect(() => {
    const go = () => {
      if (location.hash !== "#sample-week") return;
      history.replaceState(null, "", location.pathname + location.search);
      sampleLatest.current();
    };
    const t = setTimeout(go, 0);
    window.addEventListener("hashchange", go);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", go);
    };
  }, []);

  function answer(a: Answer) {
    if (!session) return;
    const trial = planFrom(readings, { zone, answers: [...answers, a] });
    if (trial.errors[a.question_id]) {
      setError({ q: a.question_id, message: trial.errors[a.question_id] });
      return;
    }
    setError(null);
    setAnswers((xs) => [...xs, a]);
  }

  function select(id: string) {
    setSelected(id);
    setDrawer(id);
    const ev = plan?.items.find((i) => i.id === id)?.evidence[0] ?? plan?.classes.find((c) => c.id === id)?.evidence;
    const input = ev && inputs.find((i) => i.id === ev.source_id);
    if (ev && input) setAt({ input: input.id, page: Math.max(0, input.pages.findIndex((p) => (p.page ?? null) === (ev.page ?? null))) }); // prettier-ignore
  }

  // New readings: draw the outlines again, then bring the cards in. A fallback makes sure they always arrive.
  const readCount = readings.length;
  const lastCount = useRef(0);
  useEffect(() => {
    if (readCount > lastCount.current) {
      setReveal((r) => r + 1);
      setArrival("waiting");
      if (lastCount.current === 0) results.current?.scrollIntoView({ block: "start" });
    }
    lastCount.current = readCount;
  }, [readCount]);
  // The cards arrive when the plan itself is in view (useSeen), not before: after the outlines finish, or as soon as
  // the plan is reached if that's first. They pause with it, and finish on time it was actually seen.
  const { attach: planAttach, started: planStarted, visible: planVisible, whenVisible: planWhenVisible, isVisible: planIsVisible } = useSeen(); // prettier-ignore
  const reducedMotion = useReducedMotion();
  // Reaching the plan before the outlines finish counts as their signal.
  const cards = arrival === "waiting" && planStarted ? "arriving" : arrival;
  useEffect(() => {
    if (cards !== "arriving" || !planStarted) return;
    let gone = false;
    void seenWait({ whenVisible: planWhenVisible, isVisible: planIsVisible })(reducedMotion ? 0 : 1200).then(
      () => !gone && setArrival("done"),
    );
    return () => void (gone = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the hook's functions are stable
  }, [cards, planStarted, reducedMotion]);
  const revealed = useCallback(() => setArrival((a) => (a === "waiting" ? "arriving" : a)), []);
  // As the cards land, ink streams from each SAM outline into its cards (swarm.ts).
  useEffect(() => {
    if (cards !== "arriving" || !planStarted || reducedMotion) return;
    const t = setTimeout(swarm, 60);
    return () => clearTimeout(t);
  }, [cards, planStarted, reducedMotion]);
  const arrive = (n: number) =>
    cards === "done" || reducedMotion
      ? undefined
      : cards === "arriving" && planStarted
        ? `forum-arrive forum-d${Math.min(n, 12)}`
        : "opacity-0";
  const planAnim = cards === "done" || reducedMotion ? "done" : !planStarted ? "idle" : planVisible ? "playing" : "paused"; // prettier-ignore
  const closeDrawer = useCallback(() => setDrawer(null), []);

  const marks: Mark[] = plan
    ? [
        ...plan.classes.map((c) => ({ id: c.id, evidence: c.evidence, status: c.status })),
        ...plan.items.flatMap((i) => i.evidence.map((evidence) => ({ id: i.id, evidence, status: i.status }))),
      ]
    : [];
  const questions = plan ? [...plan.questions].sort((a, b) => Number(later.includes(a.id)) - Number(later.includes(b.id))) : []; // prettier-ignore
  const q = questions[0] ?? null;
  const recorded = inputs.some((i) => i.recorded);
  const cost = inputs.reduce((a, i) => a + i.cost_usd, 0);
  const asked = answers.filter((a) => !/^(edit|confirm|skip):/.test(a.question_id)).length;
  const all = plan ? [...plan.items, ...plan.classes] : [];
  const verified = all.filter((x) => x.status === "verified").length;
  const hintSeen = useStored(HINT) !== null;
  // What each input contributed to the plan so far (a PDF still reading counts the pages that are in).
  const found = Object.fromEntries(
    inputs.map((i) => {
      const mine = [
        ...(plan?.items.filter((x) => x.evidence.some((e) => e.source_id === i.id)) ?? []),
        ...(plan?.classes.filter((x) => x.evidence.source_id === i.id) ?? []),
      ];
      return [i.id, { all: mine.length, verified: mine.filter((x) => x.status === "verified").length }];
    }),
  );
  const today = inputs.map((i) => i.added_at.slice(0, 10)).sort()[0] ?? "";
  const tone = plan ? palette([...plan.items.map((i) => i.course), ...plan.classes.map((c) => c.course)]) : null;

  return (
    <div className="flex flex-col gap-20 sm:gap-28">
      <Upload
        inputs={inputs}
        busy={busy}
        onAdd={add}
        onPaste={addPaste}
        onRead={readAll}
        onSample={trySample}
        onKind={setKind}
        onRemove={remove}
        found={found}
      />

      <section id="prove" aria-labelledby="prove-title" className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="forum-caps">II · Prove</span>
        <Reveal id="prove-title" className="forum-display text-3xl sm:text-4xl" text="Every date, with its proof." />
        <p className="max-w-2xl text-ink-2">
          Each item links to the exact words it came from and how its date was worked out. Tap one to see it.
        </p>
      </div>
      <div ref={results} className={loading && !plan ? "min-h-[100svh]" : ""}>
      {!loading && !plan && (
        <div className="flex flex-col items-start gap-4 rounded-2xl border border-line bg-card p-6">
          <p className="text-ink-2">Nothing to prove yet. Open the sample week to see a verified plan, or add your own above.</p>
          <button onClick={trySample} className={buttonClass("quiet")}>
            Open the sample week
          </button>
        </div>
      )}
      {loading && !plan && (
        <div className="flex flex-col gap-3" role="status">
          <p className="forum-display text-3xl text-ink-2 sm:text-4xl">Reading your week…</p>
          <p className="text-ink-2">The plan appears here, with every date traced to the words it came from.</p>
        </div>
      )}
      {plan && session && (
        <section aria-labelledby="results-title" className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h3 id="results-title" className="forum-display text-2xl sm:text-3xl">
                What Lens found.
              </h3>
              {answers.length > 0 && (
                <button onClick={() => setAnswers((xs) => xs.slice(0, -1))} className={buttonClass("plain")}>
                  Undo last answer
                </button>
              )}
            </div>
            <p className="text-ink-2">
              <span className="text-ink">{all.length} found</span> · {verified} verified ·{" "}
              {all.length - verified} {all.length - verified === 1 ? "needs" : "need"} a look · times in{" "}
              {zone.replace("_", " ")}
              {recorded ? " · the sample week, recorded, so it's free" : cost > 0 ? ` · read for ${money(cost)}` : ""}
            </p>
            {all.length === 0 ? (
              <p role="status" className="rounded-2xl border border-line bg-card p-4 text-sm">
                Lens didn&apos;t find any dates or classes here. Try a sharper photo, or a page that lists dates.
              </p>
            ) : (
              !hintSeen && (
                <p className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-sm">
                  <span>Tap any item to see where it came from.</span>
                  <button onClick={() => writeStored(HINT, "1")} className={buttonClass("plain", "min-h-9 px-2")}>
                    Got it
                  </button>
                </p>
              )
            )}
          </div>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
            <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
              <Viewer
                inputs={inputs.filter((i) => i.status === "read")}
                at={at}
                onAt={setAt}
                marks={marks}
                selected={selected}
                onSelect={select}
                reveal={reveal}
                onRevealed={revealed}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-8">
              {q ? (
                <QuestionCard
                  key={q.id}
                  q={q}
                  plan={plan}
                  inputs={inputs}
                  index={asked + 1}
                  total={asked + questions.length}
                  error={error?.q === q.id ? error.message : null}
                  onAnswer={answer}
                  onLater={questions.length > 1 ? () => setLater((xs) => [...xs.filter((x) => x !== q.id), q.id]) : null}
                />
              ) : (
                <div className="rounded-2xl border border-line bg-card p-6">
                  <p className="forum-display text-xl">No questions left.</p>
                  <p className="mt-1 text-sm text-ink-2">Anything still marked &ldquo;needs a look&rdquo; waits for an edit before it can be sent.</p>
                </div>
              )}

              <SendPanel plan={plan} sources={session.sources} />
            </div>
          </div>
          <section aria-labelledby="plan-title" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="plan-title" className="forum-display text-2xl">Your plan</h3>
              <div role="radiogroup" aria-label="Plan view" className="flex rounded-lg border border-line-strong p-1">
                {(["week", "semester"] as const).map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={view === v}
                    onClick={() => setView(v)}
                    className={`min-h-9 rounded-md px-3 text-sm capitalize ${view === v ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div ref={planAttach} data-anim={planAnim} className={planAnim === "paused" ? "anim-paused" : undefined}>
              {view === "week" ? (
                <WeekView plan={plan} today={today} onOpen={select} arrive={arrive} />
              ) : (
                <SemesterView plan={plan} onOpen={select} />
              )}
            </div>
            {plan.classes.length > 0 && tone && (
              <div className="flex flex-col gap-2">
                <h4 className="text-sm text-ink-2">Classes, weekly</h4>
                <ul className="flex flex-wrap gap-2">
                  {plan.classes.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => select(c.id)} className="flex min-h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm hover:border-line-strong">
                        <Swatch tone={tone(c.course)} />
                        {c.course} {c.meeting_type}
                        {c.status !== "verified" && <Chip status={c.status} />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.crossed_out.length > 0 && (
              <p className="text-xs text-ink-2">
                Left out because they&apos;re crossed off: {plan.crossed_out.map((c) => `\u201c${c.title}\u201d`).join(", ")}.
              </p>
            )}
          </section>
        </section>
      )}
      </div>
      </section>

      {plan && <EvidenceDrawer plan={plan} inputs={inputs} id={drawer} onClose={closeDrawer} onAnswer={answer} />}
    </div>
  ); // prettier-ignore
}
