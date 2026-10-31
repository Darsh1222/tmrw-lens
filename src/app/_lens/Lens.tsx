"use client";

import { DateTime } from "luxon";
import { useMemo, useRef, useState } from "react";
import sample from "@/lib/demo/sample-week.json";
import type { Answer } from "@/lib/plan/answer";
import { planFrom } from "@/lib/plan/session";
import type { PageReading, SourceReading } from "@/lib/plan/types";
import type { SourceKind } from "@/lib/schemas/evidence";
import { Items } from "./Items";
import { KIND_LABEL, prepare } from "./prepare";
import { QuestionCard } from "./QuestionCard";
import { SendPanel } from "./SendPanel";
import { metaOf, type Input } from "./types";
import { money } from "./ui";
import { Viewer, type Mark } from "./Viewer";

// The whole Lens flow on one page: add inputs, read them, see what was found
// with its evidence, answer one question at a time, send to Tomorrow. The page
// holds everything (inputs, readings, answers); the plan is recomputed from
// them on every change, so nothing about a visitor lives on the server.

const SAMPLE = sample as unknown as { zone: string; files: string[]; readings: SourceReading[] };
const PICKABLE: SourceKind[] = ["testudo_screenshot", "syllabus_pdf", "whiteboard_photo", "notes_photo"];
const CONCURRENCY = 3;

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
  const [paste, setPaste] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (id: string, f: (i: Input) => Input) => setInputs((xs) => xs.map((x) => (x.id === id ? f(x) : x)));

  const readings: SourceReading[] = useMemo(
    () =>
      inputs
        .filter((i) => i.status === "read")
        .map((i) => ({ source: metaOf(i), pages: i.readings.filter((r): r is PageReading => r !== null) })),
    [inputs],
  );
  const session = useMemo(() => (readings.length ? planFrom(readings, { zone, answers }) : null), [readings, zone, answers]); // prettier-ignore
  const plan = session?.plan ?? null;

  async function add(files: FileList | File[]) {
    setBusy("Getting your files ready…");
    const now = DateTime.now().setZone(zone).toISO()!;
    if (inputs.some((i) => i.recorded)) {
      setInputs([]);
      setAnswers([]);
    }
    setZone(browserZone());
    for (const file of Array.from(files)) {
      try {
        const p = await prepare(file, file.name);
        const taken = p.takenAt ? DateTime.fromISO(p.takenAt, { zone: browserZone(), setZone: /[+-]\d{2}:\d{2}$/.test(p.takenAt) }).toISO() : null; // prettier-ignore
        setInputs((xs) => {
          const base = xs.filter((x) => !x.recorded);
          return [
            ...base,
            {
              id: newId(),
              name: file.name,
              kind: p.kind,
              label: labelled(base, p.label),
              captured_at: p.kind === "whiteboard_photo" || p.kind === "notes_photo" ? taken : null,
              added_at: now,
              pages: p.pages,
              readings: p.pages.map(() => null),
              status: "ready",
              done: 0,
              error: null,
              note: p.note,
              cost_usd: 0,
              recorded: false,
            },
          ];
        });
      } catch (e) {
        setBusy(null);
        alert(e instanceof Error ? e.message : "Couldn't open that file.");
      }
    }
    setBusy(null);
  }

  async function addPaste() {
    if (!paste.trim()) return;
    await add([new File([paste], "testudo.txt", { type: "text/plain" })]);
    setPaste("");
  }

  function setKind(id: string, kind: SourceKind) {
    update(id, (i) => ({
      ...i,
      kind,
      label: KIND_LABEL[kind],
      captured_at: kind === "whiteboard_photo" || kind === "notes_photo" ? i.captured_at : null,
    }));
  }

  async function readAll() {
    const todo = inputs.filter((i) => i.status === "ready" || i.status === "error");
    const jobs = todo.flatMap((i) => i.pages.map((p, n) => ({ input: i, page: p, n })));
    for (const i of todo) update(i.id, (x) => ({ ...x, status: "reading", error: null, done: 0 }));
    let next = 0;
    const failed = new Set<string>();
    const worker = async () => {
      while (next < jobs.length) {
        const { input, page, n } = jobs[next++];
        if (failed.has(input.id)) continue;
        const form = new FormData();
        form.set("meta", JSON.stringify({ kind: input.kind, page: page.page }));
        if (page.blob) form.set("image", page.blob, "page");
        if (page.text) form.set("text", page.text);
        const res = await fetch("/api/read", { method: "POST", body: form }).catch(() => null);
        const body = res ? await res.json().catch(() => null) : null;
        if (!res?.ok || !body?.page) {
          failed.add(input.id);
          update(input.id, (x) => ({ ...x, status: "error", error: body?.error ?? "Couldn't reach Lens. Try again." }));
          continue;
        }
        update(input.id, (x) => {
          const readings = x.readings.map((r, k) => (k === n ? (body.page as PageReading) : r));
          const done = readings.filter(Boolean).length;
          return { ...x, readings, done, cost_usd: x.cost_usd + (body.cost_usd ?? 0), status: done === x.pages.length ? "read" : "reading" }; // prettier-ignore
        });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (todo[0]) setAt({ input: todo[0].id, page: 0 });
  }

  async function trySample() {
    setBusy("Opening the sample week…");
    setAnswers([]);
    setSelected(null);
    setLater([]);
    setZone(SAMPLE.zone);
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
      setAt({ input: out[0].id, page: 0 });
    } finally {
      setBusy(null);
    }
  }

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
    const ev = plan?.items.find((i) => i.id === id)?.evidence[0] ?? plan?.classes.find((c) => c.id === id)?.evidence;
    const input = ev && inputs.find((i) => i.id === ev.source_id);
    if (ev && input) setAt({ input: input.id, page: Math.max(0, input.pages.findIndex((p) => (p.page ?? null) === (ev.page ?? null))) }); // prettier-ignore
    document.getElementById(`row-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  const marks: Mark[] = plan
    ? [
        ...plan.classes.map((c) => ({ id: c.id, evidence: c.evidence, status: c.status })),
        ...plan.items.flatMap((i) => i.evidence.map((evidence) => ({ id: i.id, evidence, status: i.status }))),
      ]
    : [];
  const questions = plan ? [...plan.questions].sort((a, b) => Number(later.includes(a.id)) - Number(later.includes(b.id))) : []; // prettier-ignore
  const q = questions[0] ?? null;
  const unread = inputs.filter((i) => i.status === "ready" || i.status === "error");
  const reading = inputs.some((i) => i.status === "reading");
  const recorded = inputs.some((i) => i.recorded);
  const cost = inputs.reduce((a, i) => a + i.cost_usd, 0);
  const asked = answers.filter((a) => !/^(edit|confirm|skip):/.test(a.question_id)).length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Tomorrow Lens</h1>
        <p className="max-w-2xl text-text-secondary">
          Add your week: a Testudo schedule, a syllabus, a whiteboard, your notes. Lens reads them with Muse Spark and
          SAM 3.1, checks every date against the words it came from, and asks only what it can&apos;t settle.
        </p>
      </header>

      <section aria-label="Add inputs" className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => fileRef.current?.click()} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">
            Add photos or PDFs
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.pdf,.txt"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void add(e.target.files);
              e.target.value = "";
            }}
          />
          <button onClick={trySample} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface">
            Try the sample week
          </button>
          {busy && <span className="text-sm text-text-secondary">{busy}</span>}
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-text-secondary">Or paste your Testudo schedule as text</summary>
          <div className="mt-2 flex flex-col gap-2">
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} className="rounded-md border border-border bg-bg p-2 font-mono text-xs" aria-label="Testudo schedule text" />
            <button onClick={addPaste} disabled={!paste.trim()} className="self-start rounded-md border border-border px-3 py-1 disabled:opacity-50">
              Add it
            </button>
          </div>
        </details>
        <p className="text-xs text-text-secondary">
          Photos are shrunk in your browser and read one at a time; Lens doesn&apos;t keep them. What was read is cached
          for a day, locked so only the same photo can open it.
        </p>

        {inputs.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {inputs.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                {i.status === "ready" && i.kind !== "testudo_text" && i.kind !== "syllabus_pdf" ? (
                  <select value={i.kind} onChange={(e) => setKind(i.id, e.target.value as SourceKind)} className="rounded-md border border-border bg-bg px-1.5 py-1" aria-label={`What ${i.name} is`}>
                    {PICKABLE.filter((k) => k !== "syllabus_pdf").map((k) => (
                      <option key={k} value={k}>{KIND_LABEL[k]}</option>
                    ))}
                  </select>
                ) : (
                  <span className="font-medium">{i.label}</span>
                )}
                <span className="text-text-secondary">{i.recorded ? "sample" : i.name}</span>
                <span className="text-text-secondary">
                  {i.status === "reading" && `reading ${i.done} of ${i.pages.length}…`}
                  {i.status === "read" && (i.recorded ? "read (recorded)" : `read · ${money(i.cost_usd)}`)}
                  {i.status === "error" && <span className="text-unverified">{i.error}</span>}
                </span>
                {i.note && <span className="text-xs text-text-secondary">{i.note}</span>}
              </li>
            ))}
          </ul>
        )}
        {unread.length > 0 && (
          <button onClick={readAll} disabled={reading} className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {reading ? "Reading…" : `Read ${unread.length === 1 ? "it" : `all ${unread.length}`}`}
          </button>
        )}
        {recorded && (
          <p className="text-xs text-text-secondary">
            The sample week is made up, and its readings were recorded from Muse Spark and SAM 3.1, so trying it is
            free. Add your own to read them live.
          </p>
        )}
      </section>

      {plan && session && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-4 lg:self-start">
            <Viewer inputs={inputs.filter((i) => i.status === "read")} at={at} onAt={setAt} marks={marks} selected={selected} onSelect={select} />
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
              <span>
                {plan.items.filter((i) => i.status === "verified").length + plan.classes.filter((c) => c.status === "verified").length} of{" "}
                {plan.items.length + plan.classes.length} verified · times in {zone.replace("_", " ")}
                {!recorded && cost > 0 ? ` · read for ${money(cost)}` : ""}
              </span>
              {answers.length > 0 && (
                <button onClick={() => setAnswers((xs) => xs.slice(0, -1))} className="hover:text-text">
                  Undo last answer
                </button>
              )}
            </div>
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
              <p className="rounded-xl border border-verified/40 bg-verified/5 p-4 text-sm">
                No questions left. Anything still amber needs an edit before it can be sent.
              </p>
            )}
            <Items plan={plan} inputs={inputs} selected={selected} onSelect={select} onAnswer={answer} />
            <SendPanel plan={plan} sources={session.sources} />
          </div>
        </div>
      )}
    </main>
  ); // prettier-ignore
}
