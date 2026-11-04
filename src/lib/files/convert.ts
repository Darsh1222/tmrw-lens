import { strFromU8, unzipSync } from "fflate";
import { DateTime } from "luxon";
import type { PageReading } from "@/lib/plan/types";
import type { SyllabusPageExtraction } from "@/lib/schemas/extraction";

// Files that already hold their words: Word, PowerPoint, Excel, CSV, a saved
// web page, a calendar export. Their text is taken out in code (no picture of
// the page, no vision call), then read once as text, where every quote is
// checked against the text itself. A calendar file needs no model at all: its
// dates are exact, so its items are built here, in words the date resolver
// reads the same way it reads a syllabus.

export const TEXT_LIMIT = 40_000;

/** A page whose text layer is real text, not a scan with a few stray characters: it's read as text, no vision. */
export const usableText = (t: string | null | undefined) => !!t && t.replace(/\s+/g, "").length >= 40;

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const tidy = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join("\n")
    .trim();

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch {
    throw new Error("This file couldn't be opened. If it's password-protected, save a copy without the password.");
  }
}

/** Word: paragraphs as lines, table cells separated by " | ", one row per line. */
export function docxText(bytes: Uint8Array): string {
  const xml = unzip(bytes)["word/document.xml"];
  if (!xml) throw new Error("This doesn't look like a Word document.");
  return tidy(
    decode(
      strFromU8(xml)
        // Paragraphs inside a table cell are one cell: joined by a space, not broken into lines.
        .replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (cell) => cell.replace(/<\/w:p>/g, " "))
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br[^>]*\/>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<\/w:tc>/g, " | ")
        .replace(/<\/w:tr>/g, "\n")
        .replace(/<[^>]+>/g, ""),
    ).replace(/ *\| *(\n|$)/g, "$1"),
  );
}

/** PowerPoint: each slide's text, in slide order, under "Slide N". */
export function pptxText(bytes: Uint8Array): string {
  const files = unzip(bytes);
  const slides = Object.keys(files)
    .map((f) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  if (!slides.length) throw new Error("This doesn't look like a PowerPoint file.");
  return slides
    .map(
      ([f, n]) =>
        `Slide ${n}\n${tidy(
          decode(
            strFromU8(files[f])
              .replace(/<\/a:p>/g, "\n")
              .replace(/<[^>]+>/g, ""),
          ),
        )}`,
    ) // prettier-ignore
    .join("\n\n");
}

/** Excel serial day (1900 system) to a date, as people write it: "Nov 11, 2026", with a time when there is one. */
function serialDate(v: number): string {
  const d = DateTime.fromObject({ year: 1899, month: 12, day: 30 }, { zone: "utc" }).plus({ days: Math.floor(v) });
  const mins = Math.round((v % 1) * 1440);
  const date = d.toFormat("LLL d, yyyy");
  return mins ? `${date} ${d.startOf("day").plus({ minutes: mins }).toFormat("h:mma").toLowerCase()}` : date;
}

/** Excel: every sheet, a row per line, cells separated by " | ". Date cells are written out as dates. */
export function xlsxText(bytes: Uint8Array): string {
  const files = unzip(bytes);
  const read = (f: string) => (files[f] ? strFromU8(files[f]) : "");
  if (!files["xl/workbook.xml"]) throw new Error("This doesn't look like an Excel file.");
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  // Which cell styles are dates: the built-in date formats (14-22, 45-47) and any custom format with d, m, or y.
  const styles = read("xl/styles.xml");
  const custom = new Map([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), m[2]])); // prettier-ignore
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  const dateStyle = [...xfs.matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].map((m) => {
    const id = Number(m[1]);
    return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dmy]/i.test((custom.get(id) ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, "")); // prettier-ignore
  });
  const names = [...read("xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decode(m[1]));
  const sheets = Object.keys(files)
    .map((f) => /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  return sheets
    .map(([f, n]) => {
      const rows = [...strFromU8(files[f]).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
        [...row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
          .map(([, attrs, body = ""]) => {
            const t = /t="(\w+)"/.exec(attrs)?.[1];
            const s = Number(/ s="(\d+)"/.exec(attrs)?.[1] ?? -1);
            const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
            if (t === "s" && v !== undefined) return shared[Number(v)] ?? "";
            if (t === "inlineStr") return decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")); // prettier-ignore
            if (v === undefined) return "";
            return t !== "str" && dateStyle[s] && !Number.isNaN(Number(v)) ? serialDate(Number(v)) : decode(v);
          })
          .join(" | ")
          .replace(/( \| )+$/, ""),
      );
      return `${names[Number(n) - 1] ?? `Sheet ${n}`}\n${rows.filter((r) => r.replace(/[ |]/g, "")).join("\n")}`;
    })
    .join("\n\n");
}

/** A saved web page (Canvas, ELMS): its visible text, a line per block. */
export function htmlText(html: string): string {
  return tidy(
    decode(
      html
        .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|table|ul|ol)>/gi, "\n")
        .replace(/<\/t[dh]>/gi, " | ")
        .replace(/<[^>]+>/g, ""),
    ),
  );
}

/** A CSV: rows as lines, cells separated by " | " (quoted commas kept). */
export function csvText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const cells: string[] = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && line[i + 1] === '"' && q) {
          cur += '"';
          i++;
        } else if (ch === '"') q = !q;
        else if (ch === "," && !q) {
          cells.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      cells.push(cur.trim());
      return cells.filter(Boolean).join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}

const KIND: [RegExp, SyllabusPageExtraction["items"][number]["kind"]][] = [
  [/\b(exam|midterm|final)\b/i, "exam"],
  [/\bquiz\b/i, "quiz"],
  [/\bproject\b/i, "project"],
  [/\b(read|reading|chapter)\b/i, "reading"],
  [/\b(due|assignment|homework|hw|problem set|pset|lab report|essay|paper)\b/i, "assignment"],
];

/**
 * A calendar export (.ics): each one-off event becomes an item, its date and time written out in a line that's also
 * the page's text, so the quote, the check, and the date math work exactly as they do for a syllabus. Repeating events
 * (classes) are left out: the schedule is where classes come from.
 */
export function icsReading(text: string, zone: string): { reading: PageReading; note: string | null } {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") cur = {};
    else if (l === "END:VEVENT" && cur) {
      events.push(cur);
      cur = null;
    } else if (cur) {
      const i = l.indexOf(":");
      if (i > 0) cur[l.slice(0, i).split(";")[0].toUpperCase()] = l.slice(i + 1);
      if (i > 0 && /^DTSTART;.*TZID=/i.test(l)) cur.TZID = /TZID=([^;:]+)/i.exec(l)![1];
      if (i > 0 && /^DTSTART;VALUE=DATE/i.test(l)) cur.ALLDAY = "1";
    }
  }
  if (!events.length) throw new Error("This calendar file has no events.");
  const when = (v: string | undefined, tz: string | undefined, allDay: boolean) => {
    if (!v) return null;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(v.trim());
    if (!m) return null;
    const [, y, mo, d, h, mi, , z] = m;
    if (allDay || h === undefined) return { dt: DateTime.fromObject({ year: +y, month: +mo, day: +d }, { zone }), timed: false }; // prettier-ignore
    const dt = DateTime.fromObject({ year: +y, month: +mo, day: +d, hour: +h, minute: +mi }, { zone: z ? "utc" : (tz ?? zone) }).setZone(zone); // prettier-ignore
    return { dt, timed: true };
  };
  const clock = (dt: DateTime) => dt.toFormat(dt.minute ? "h:mma" : "ha").toLowerCase();
  const out: string[] = [];
  const items: SyllabusPageExtraction["items"] = [];
  let repeating = 0;
  for (const e of events) {
    if (e.RRULE) {
      repeating++;
      continue;
    }
    const title = (e.SUMMARY ?? "")
      .replace(/\\([,;\\])/g, "$1")
      .replace(/\\n/gi, " ")
      .trim();
    const start = when(e.DTSTART, e.TZID, !!e.ALLDAY);
    if (!title || !start) continue;
    const end = start.timed ? when(e.DTEND, e.TZID, false) : null;
    const date_text = start.dt.toFormat("LLL d, yyyy");
    const time_text = start.timed ? `${clock(start.dt)}${end && end.dt > start.dt && end.dt.hasSame(start.dt, "day") ? `-${clock(end.dt)}` : ""}` : null; // prettier-ignore
    const line = `${title}: ${date_text}${time_text ? `, ${time_text}` : ""}`;
    out.push(line);
    items.push({ kind: KIND.find(([re]) => re.test(title))?.[1] ?? "other", title, date_text, time_text, weight_text: null, evidence: { quote: line, box: null } }); // prettier-ignore
  }
  if (!items.length) throw new Error("This calendar file only has repeating events (like classes). Add your Testudo schedule for those."); // prettier-ignore
  // The course, when every event names the same one ("MATH141 Exam 2").
  const codes = new Set(items.map((i) => /\b([A-Z]{3,4}) ?(\d{3}[A-Z]?)\b/.exec(i.title)).map((m) => (m ? m[1] + m[2] : null))); // prettier-ignore
  const course = codes.size === 1 ? [...codes][0] : null;
  const extraction: SyllabusPageExtraction = { course_code: course, course_title: null, term_start: null, term_end: null, breaks: [], items }; // prettier-ignore
  return {
    reading: { page: null, text: out.join("\n"), extraction, rereads: {} },
    note: repeating ? `${repeating} repeating ${repeating === 1 ? "event" : "events"} (like classes) left out; add your Testudo schedule for classes.` : null, // prettier-ignore
  };
}
