import type { ItemKind } from "@/lib/plan/types";

// Matching the way people write courses and items ("calc", "131", "PS6",
// "Proj 4") to the courses Lens knows from the schedule and syllabi.

export type KnownCourse = { code: string; title: string | null };

const CODE = /^([A-Z]{4})\s?(\d{3}[A-Z]?)$/;

export function normalizeCode(text: string): string | null {
  const m = CODE.exec(text.trim().toUpperCase());
  return m ? `${m[1]}${m[2]}` : null;
}

// Short words people write for course titles. Title words of 4+ letters also match by prefix ("calc" → "Calculus").
const NICKNAMES: Record<string, string[]> = {
  physics: ["phys"],
  programming: ["prog", "cs", "java"],
  writing: ["engl", "english"],
};

export type CourseMatch = { code: string | null; ambiguous: string[] };

/** Resolves a course hint to one known course code; `ambiguous` lists the codes when it could be more than one. */
export function matchCourse(hint: string | null, known: KnownCourse[]): CourseMatch {
  if (!hint) return { code: null, ambiguous: [] };
  const exact = normalizeCode(hint.replace(/[^A-Za-z0-9 ]/g, ""));
  if (exact) return { code: exact, ambiguous: [] };
  const h = hint.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!h) return { code: null, ambiguous: [] };
  const hits = known.filter((c) => {
    const [, subject, number] = CODE.exec(c.code)!;
    if (h === number.toLowerCase() || h === subject.toLowerCase()) return true;
    const words = (c.title ?? "").toLowerCase().match(/[a-z]{4,}/g) ?? [];
    return words.some((w) => (h.length >= 4 && (w.startsWith(h) || h.startsWith(w))) || NICKNAMES[w]?.includes(h));
  });
  const codes = [...new Set(hits.map((c) => c.code))];
  return codes.length === 1 ? { code: codes[0], ambiguous: [] } : { code: null, ambiguous: codes };
}

const FAMILIES: { re: RegExp; family: string; num?: RegExp }[] = [
  { re: /\bfinal\b/, family: "final" },
  { re: /\bmid-?terms?\b/, family: "midterm", num: /\bmid-?terms?\s*#?\s*(\d+)/ },
  { re: /\bquiz(zes)?\b/, family: "quiz", num: /\bquiz\s*#?\s*(\d+)/ },
  { re: /\bexams?\b/, family: "exam", num: /\bexams?\s*#?\s*(\d+)/ },
  {
    re: /\b(problem sets?|psets?|ps\s*\d|p-sets?|homework|hw)\b/,
    family: "pset",
    num: /\b(?:problem sets?|psets?|ps|p-sets?|homework|hw)\s*#?\s*(\d+)/,
  },
  { re: /\b(projects?|proj|p\d)\b/, family: "project", num: /\b(?:projects?|proj|p)\s*#?\s*(\d+)/ },
  { re: /\blab reports?\b/, family: "lab_report", num: /\blab reports?\s*#?\s*(\d+)/ },
  { re: /\b(draft|essay|paper)\b/, family: "essay" },
  { re: /\b(read|reading)\b/, family: "reading" },
];

export function familyOf(title: string): { family: string | null; number: number | null } {
  const t = title.toLowerCase();
  for (const f of FAMILIES) {
    if (!f.re.test(t)) continue;
    const n = f.num?.exec(t);
    return { family: f.family, number: n ? Number(n[1]) : null };
  }
  return { family: null, number: null };
}

/** Tomorrow's item kinds, from the kinds the extraction tasks use. */
export function itemKind(kind: string): ItemKind {
  if (kind === "exam" || kind === "quiz") return "exam";
  if (kind === "assignment" || kind === "project") return "deadline";
  return "task";
}
