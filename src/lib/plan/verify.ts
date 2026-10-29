import { contains, similarity } from "@/lib/plan/text";
import { ok, type Check, type PageReading } from "@/lib/plan/types";

// Is the quote really in the source, and is each field really in the quote?
// A page with its own text (pasted, or a PDF's text layer) settles the first by
// search. A photo settles it with a second, independent read of the box.

export type ReadingCheck = {
  quote: Check;
  /** One check per field text, in the order given; null fields pass. */
  fields: Check[];
  reread: string | null;
};

const SIMILAR = 0.85;

/** A quote can join lines that aren't next to each other (a course heading and its meeting); each line must be there. */
function linesIn(haystack: string, quote: string): boolean {
  const lines = quote
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((l) => contains(haystack, l));
}

const unverified = (reason: string): Check => ({ status: "unverified", reason });

export function verifyReading(
  page: PageReading,
  key: string,
  quote: string,
  fields: (string | null)[],
  unsure = false,
): ReadingCheck {
  const reread = page.rereads[key] ?? null;
  let quoteCheck: Check;
  if (page.text !== null) {
    quoteCheck = linesIn(page.text, quote) ? ok : unverified("That line isn't in the source text.");
  } else if (!reread) {
    quoteCheck = unverified("There was no box to check this against.");
  } else if (linesIn(reread.text, quote) || similarity(reread.text, quote) >= SIMILAR) {
    // Two reads agree. If either reader found it hard to read, the person still gets the final say.
    const shaky = (unsure || reread.legible === "unsure") && !linesIn(reread.text, quote);
    quoteCheck = shaky ? { status: "needs_question", reason: "It's hard to read." } : ok;
  } else {
    quoteCheck = unverified(`A second read saw "${reread.text}".`);
  }

  const fieldChecks = fields.map((f): Check => {
    if (f === null) return ok;
    if (!contains(quote, f)) return unverified(`"${f}" isn't in the quote.`);
    if (page.text === null && reread && !contains(reread.text, f))
      return unverified(`A second read saw "${reread.text}".`);
    return ok;
  });
  return { quote: quoteCheck, fields: fieldChecks, reread: reread?.text ?? null };
}

const RANK: Record<Check["status"], number> = { verified: 0, needs_question: 1, conflict: 2, unverified: 3 };

export function worst(...checks: Check[]): Check {
  return checks.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a), ok);
}
