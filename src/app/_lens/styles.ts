// Class names shared by server and client components (no "use client": the
// server-rendered pages use these too).

const BUTTON = {
  primary: "bg-crimson-fill text-on-crimson",
  quiet: "border border-line-strong text-ink hover:bg-well",
  plain: "text-ink-2 hover:text-ink",
};

export function buttonClass(kind: keyof typeof BUTTON = "quiet", extra = "") {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50 ${BUTTON[kind]} ${extra}`; // prettier-ignore
}
