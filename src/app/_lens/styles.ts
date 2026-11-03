// Class names shared by server and client components (no "use client": the
// server-rendered pages use these too).

// One primary colour (crimson) for the one main action in a place; quiet (outlined) for the rest; plain for links
// that act. Every kind shows hover, press, and keyboard focus (the outline is global, in theme.css).
const BUTTON = {
  primary: "bg-crimson-fill text-on-crimson shadow-sm hover:brightness-90 active:brightness-[.85]",
  quiet: "border border-line-strong bg-transparent text-ink hover:border-ink/40 hover:bg-well active:bg-line",
  plain: "text-ink-2 hover:text-ink active:text-ink",
};

export function buttonClass(kind: keyof typeof BUTTON = "quiet", extra = "") {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-[color,background-color,border-color,filter,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 ${BUTTON[kind]} ${extra}`; // prettier-ignore
}
