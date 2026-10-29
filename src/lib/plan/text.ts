// Text comparison for verification. Lenient about what doesn't change meaning
// (case, spacing, curly quotes, dash styles), strict about everything else,
// digits most of all.

export function norm(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same as `norm`, minus spaces, so "Oct 26 - Oct 30" matches a text layer's "Oct 26 -Oct 30". */
function squash(text: string): string {
  return norm(text).replace(/ /g, "");
}

export function contains(haystack: string, needle: string): boolean {
  return squash(haystack).includes(squash(needle));
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** 1 for identical, 0 for nothing in common, after `squash`. */
export function similarity(a: string, b: string): number {
  const x = squash(a);
  const y = squash(b);
  if (!x.length && !y.length) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

/** The digits in a string, in order: a re-read that changes any of them is a different reading. */
export function digits(text: string): string {
  return text.replace(/\D/g, "");
}

export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
