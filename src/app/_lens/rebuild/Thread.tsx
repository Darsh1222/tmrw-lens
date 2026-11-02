"use client";

// The texts, as a phone shows them: Tomorrow on the left, the person on the
// right, a timestamp between, and a typing indicator before each of
// Tomorrow's replies. Every bubble is in the layout from the start (invisible
// until it arrives), so nothing below moves when one lands.

export type Msg = { from: "tomorrow" | "you" | "note"; text: string; stamp: string | null; mark?: { word: string; color: string } }; // prettier-ignore
export type MsgState = "hidden" | "typing" | "shown";

function Marked({ text, mark }: { text: string; mark?: Msg["mark"] }) {
  if (!mark || !text.includes(mark.word)) return <>{text}</>;
  const [before, ...rest] = text.split(mark.word);
  return (
    <>
      {before}
      <mark className="rounded px-0.5" style={{ background: `var(--tm-${mark.color})`, color: "inherit" }}>
        {mark.word}
      </mark>
      {rest.join(mark.word)}
    </>
  );
}

export function Thread({ messages, states, hint }: { messages: Msg[]; states: MsgState[]; hint: string | null }) {
  return (
    <div
      className="relative flex h-[440px] flex-col md:h-[520px] rounded-[28px] px-4 pb-6 pt-4"
      style={{ background: "var(--tm-sunken)", border: "1px solid var(--tm-border)" }}
      aria-label="Texts with Tomorrow"
      role="log"
      aria-live="polite"
    >
      <div className="mb-4 text-center text-xs font-medium" style={{ color: "var(--tm-text-2)" }}>
        Tomorrow
      </div>
      {hint && (
        <p
          className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-sm"
          style={{ color: "var(--tm-muted)" }}
        >
          {hint}
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {messages.map((m, n) => {
          const state = states[n] ?? "hidden";
          const shown = state === "shown";
          const you = m.from === "you";
          return (
            <li key={n} className="flex flex-col gap-2" aria-hidden={!shown}>
              {m.stamp && (
                <span
                  className={`forum-in text-center text-xs ${state === "hidden" ? "forum-hidden" : ""}`}
                  style={{ color: "var(--tm-muted)" }}
                >
                  {m.stamp}
                </span>
              )}
              <div className={`relative flex ${you ? "justify-end" : "justify-start"}`}>
                {m.from === "note" ? (
                  <span
                    className={`forum-in w-full text-center text-xs italic ${shown ? "" : "forum-hidden"}`}
                    style={{ color: "var(--tm-muted)" }}
                  >
                    {m.text}
                  </span>
                ) : (
                  <p
                    className={`forum-in max-w-[78%] rounded-[20px] px-3.5 py-2 text-[15px] leading-snug ${shown ? "" : "forum-hidden"} ${you ? "rounded-br-md" : "rounded-bl-md"}`} // prettier-ignore
                    style={
                      you
                        ? { background: "var(--tm-text)", color: "var(--tm-bg)" }
                        : {
                            background: "var(--tm-surface)",
                            color: "var(--tm-text)",
                            border: "1px solid var(--tm-border)",
                          }
                    }
                  >
                    <Marked text={m.text} mark={m.mark} />
                  </p>
                )}
                {state === "typing" && (
                  <span
                    className="forum-typing absolute left-0 top-0 flex gap-1 rounded-[20px] rounded-bl-md px-3.5 py-3"
                    style={{ background: "var(--tm-surface)", border: "1px solid var(--tm-border)" }}
                    aria-label="Tomorrow is typing"
                  >
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--tm-text-2)" }} />
                    ))}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
