// Writes the synthetic fixtures in fixtures/synthetic/. Everything here is made
// up: no real student, schedule, or syllabus. Run with `pnpm fixtures`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, GlobalFonts, loadImage, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUT = join(import.meta.dirname, "..", "fixtures", "synthetic");
const FONTS = join(import.meta.dirname, "..", "fixtures", "fonts");
mkdirSync(OUT, { recursive: true });
// Handwriting fonts, both SIL Open Font License (licences next to them).
GlobalFonts.registerFromPath(join(FONTS, "Caveat.ttf"), "Caveat");
GlobalFonts.registerFromPath(join(FONTS, "PatrickHand-Regular.ttf"), "Patrick Hand");

type Meeting = { type: "Lec" | "Dis" | "Lab"; days: string; start: string; end: string; room: string };
type Course = { code: string; section: string; title: string; credits: number; color: string; meetings: Meeting[] };

const COURSES: Course[] = [
  {
    code: "MATH141",
    section: "0121",
    title: "Calculus II",
    credits: 4,
    color: "#C9E4F7",
    meetings: [
      { type: "Lec", days: "MWF", start: "10:00am", end: "10:50am", room: "ESJ 0224" },
      { type: "Dis", days: "TuTh", start: "9:00am", end: "9:50am", room: "MTH 0101" },
    ],
  },
  {
    code: "CMSC131",
    section: "0302",
    title: "Object-Oriented Programming I",
    credits: 4,
    color: "#F9E2C3",
    meetings: [
      { type: "Lec", days: "TuTh", start: "11:00am", end: "12:15pm", room: "IRB 0324" },
      { type: "Lab", days: "MW", start: "2:00pm", end: "2:50pm", room: "CSI 2107" },
    ],
  },
  {
    code: "PHYS161",
    section: "0101",
    title: "General Physics: Mechanics",
    credits: 3,
    color: "#D7EFD2",
    meetings: [{ type: "Lec", days: "MWF", start: "1:00pm", end: "1:50pm", room: "PHY 1412" }],
  },
  {
    code: "ENGL101",
    section: "0405",
    title: "Academic Writing",
    credits: 3,
    color: "#EBD9F5",
    meetings: [{ type: "Lec", days: "MW", start: "3:30pm", end: "4:45pm", room: "TWS 0236" }],
  },
];

/** A class that's shorter one day: MATH141's lecture runs 3:00-4:15 Monday and Wednesday but 3:00-3:50 Thursday. */
const SHORT_THURSDAY: typeof COURSES = [
  {
    ...COURSES[0],
    meetings: [
      { type: "Lec", days: "MW", start: "3:00pm", end: "4:15pm", room: "SYM 0200" },
      { type: "Lec", days: "Th", start: "3:00pm", end: "3:50pm", room: "CHM 1402" },
      { type: "Dis", days: "TuTh", start: "9:00am", end: "9:50am", room: "MTH 0101" },
    ],
  },
  COURSES[1],
  COURSES[2],
];

const DAY_TOKENS = ["M", "Tu", "W", "Th", "F"];
function splitDays(days: string): number[] {
  const out: number[] = [];
  for (let rest = days; rest.length;) {
    const i = DAY_TOKENS.findIndex((t) => rest.startsWith(t));
    if (i < 0) throw new Error(`bad days ${days}`);
    out.push(i);
    rest = rest.slice(DAY_TOKENS[i].length);
  }
  return out;
}
function minutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})(am|pm)$/.exec(t);
  if (!m) throw new Error(`bad time ${t}`);
  return ((Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0)) * 60 + Number(m[2]);
}

/**
 * `times: false` draws blocks with only the course and room, as some schedule views do: times come from position.
 * `popup: true` leaves a dark popup open over Thursday afternoon, its shadow and panel hiding where blocks end.
 * `tooltip: true` leaves a hover tooltip just under Thursday's short MATH141 lecture, in the clear (for SHORT_THURSDAY).
 */
function scheduleScreenshot({ list = true, times = true, popup = false, tooltip = false, courses = COURSES } = {}) {
  const W = list ? 1600 : 1010,
    H = 1000;
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  // Header bar, red like a campus portal, with the UID area already cropped out.
  g.fillStyle = "#B3241B";
  g.fillRect(0, 0, W, 64);
  g.fillStyle = "#ffffff";
  g.font = "bold 26px Helvetica";
  g.fillText("Schedule of Classes  ·  Fall 2026", 24, 42);
  g.font = "16px Helvetica";
  g.fillText("Synthetic Student (sample data)", W - 300, 40);
  if (!list) {
    g.fillStyle = "#666";
    g.font = "14px Helvetica";
    g.fillText("Weekly view", 24, 88);
  }

  // Weekly grid, 8am to 5pm.
  const gx = 24,
    gy = 110,
    colW = 190,
    hourH = 92,
    startHour = 8,
    hours = 9;
  g.fillStyle = "#222";
  g.font = "bold 18px Helvetica";
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].forEach((d, i) =>
    g.fillText(d, gx + 60 + i * colW + 8, gy - 12),
  );
  g.font = "14px Helvetica";
  g.strokeStyle = "#dddddd";
  for (let h = 0; h <= hours; h++) {
    const y = gy + h * hourH;
    g.beginPath();
    g.moveTo(gx + 60, y);
    g.lineTo(gx + 60 + 5 * colW, y);
    g.stroke();
    const hr = startHour + h;
    g.fillStyle = "#666";
    g.fillText(`${((hr + 11) % 12) + 1}${hr < 12 ? "am" : "pm"}`, gx, y + 5);
  }
  for (const course of courses)
    for (const m of course.meetings)
      for (const d of splitDays(m.days)) {
        const top = gy + ((minutes(m.start) - startHour * 60) / 60) * hourH;
        const height = ((minutes(m.end) - minutes(m.start)) / 60) * hourH;
        const x = gx + 60 + d * colW + 4;
        g.fillStyle = course.color;
        g.fillRect(x, top + 1, colW - 8, height - 2);
        g.fillStyle = "#1b1b1b";
        g.font = "bold 15px Helvetica";
        g.fillText(`${course.code} ${m.type}`, x + 8, top + 20);
        g.font = "13px Helvetica";
        if (times) {
          g.fillText(`${m.start}-${m.end}`, x + 8, top + 38);
          if (height > 60) g.fillText(m.room, x + 8, top + 55);
        } else g.fillText(m.room, x + 8, top + 38);
      }

  if (popup) {
    // A course's details popup, left open: it covers the bottom of Thursday's CMSC131 lecture (11:00-12:15) from
    // 12:00, with a soft shadow above it, the way a real one hides a block's edge.
    const x = gx + 60 + 3 * colW - 40;
    const top = gy + 4 * hourH;
    for (let k = 1; k <= 10; k++) {
      g.fillStyle = `rgba(0,0,0,${0.012 * (11 - k)})`;
      g.fillRect(x - k, top - k, 300 + 2 * k, 150 + 2 * k);
    }
    g.fillStyle = "#919191";
    g.fillRect(x, top, 300, 150);
    g.fillStyle = "#ffffff";
    g.font = "bold 15px Helvetica";
    g.fillText("Course details", x + 14, top + 26);
    g.font = "13px Helvetica";
    g.fillText("Seats: 12 of 180 open", x + 14, top + 50);
    g.fillText("Waitlist: 0", x + 14, top + 70);
  }
  if (tooltip) {
    // "MATH141 meets at ...": a hover tooltip 10 minutes under the end of Thursday's 3:00-3:50 lecture, page showing
    // between them, the way a real one sits. Close to the block, but not over it: 3:50 stands.
    const x = gx + 60 + 3 * colW - 10;
    const top = gy + 8 * hourH;
    g.fillStyle = "rgba(110,110,110,0.85)";
    g.fillRect(x, top, 250, 34);
    g.fillStyle = "#ffffff";
    g.font = "14px Helvetica";
    g.fillText("MATH141 meets at CHM 1402", x + 10, top + 22);
  }
  if (!list) return c.toBuffer("image/png");
  // List view on the right; extraction prefers it over grid positions.
  const lx = 1030;
  let y = 110;
  g.fillStyle = "#222";
  g.font = "bold 20px Helvetica";
  g.fillText("Registered courses (14 credits)", lx, y - 12);
  for (const course of COURSES) {
    g.fillStyle = "#f4f4f4";
    const blockH = 40 + course.meetings.length * 24;
    g.fillRect(lx, y, 540, blockH);
    g.fillStyle = "#1b1b1b";
    g.font = "bold 16px Helvetica";
    g.fillText(`${course.code} (${course.section})  ${course.title}`, lx + 12, y + 24);
    g.font = "14px Helvetica";
    course.meetings.forEach((m, i) =>
      g.fillText(`${m.type}  ${m.days}  ${m.start} - ${m.end}  ${m.room}`, lx + 24, y + 50 + i * 24),
    );
    y += blockH + 14;
  }
  return c.toBuffer("image/png");
}

function scheduleText() {
  const lines = ["Fall 2026 Schedule", ""];
  for (const course of COURSES) {
    lines.push(`${course.code} (${course.section}) ${course.title}  ${course.credits} credits`);
    for (const m of course.meetings) lines.push(`  ${m.type}  ${m.days}  ${m.start} - ${m.end}  ${m.room}`);
  }
  return lines.join("\n") + "\n";
}

// Fixed metadata dates, so regenerating gives byte-identical PDFs (evals check fixture hashes).
const PDF_DATE = new Date("2026-10-28T12:00:00Z");
async function newPdf() {
  const doc = await PDFDocument.create();
  doc.setCreationDate(PDF_DATE);
  doc.setModificationDate(PDF_DATE);
  doc.setProducer("tmrw-lens fixtures");
  doc.setCreator("tmrw-lens fixtures");
  return doc;
}

async function syllabusPdf() {
  const doc = await newPdf();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const write = (page: ReturnType<typeof doc.addPage>, lines: [string, boolean?, number?][]) => {
    let y = 740;
    for (const [text, isBold, size] of lines) {
      if (text)
        page.drawText(text, { x: 56, y, size: size ?? 11, font: isBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
      y -= (size ?? 11) + 9;
    }
  };

  write(doc.addPage([612, 792]), [
    ["MATH141 Calculus II, Fall 2026", true, 18],
    ["Section 0121  ·  Synthetic syllabus for testing (not a real course page)"],
    ["Instructor: Dr. A. Example  ·  Office hours: Tue 2:00-3:30pm, MTH 3104"],
    [""],
    ["Classes begin Monday, August 31, 2026. Week 1 is the week of August 31."],
    ["Last day of classes: Tuesday, December 8, 2026."],
    ["Thanksgiving break: no classes Wednesday, November 25 - Sunday, November 29."],
    [""],
    ["Grading", true, 13],
    ["Weekly problem sets  20%"],
    ["Quizzes (best 5 of 6)  15%"],
    ["Midterm 1  20%"],
    ["Midterm 2  20%"],
    ["Final exam  25%"],
    [""],
    ["Late policy", true, 13],
    ["Problem sets are due at 11:59pm on the day listed. One late set (up to 48 hours) is accepted without penalty."],
  ]);

  write(doc.addPage([612, 792]), [
    ["Course schedule", true, 16],
    ["Week   Dates            Topic                                   Due"],
    ["6      Oct 5 - Oct 9     Integration by parts                    Problem Set 4 due Thu Oct 8"],
    ["7      Oct 12 - Oct 16   Trig substitution                       Problem Set 5 due Week 7 Thu"],
    ["8      Oct 19 - Oct 23   Partial fractions                       Midterm 1, Wed Oct 21, in class"],
    ["9      Oct 26 - Oct 30   Improper integrals                      Quiz 3, Fri Oct 30"],
    ["10     Nov 2 - Nov 6     Sequences                               Problem Set 6 due Thu Nov 5"],
    ["11     Nov 9 - Nov 13    Series and convergence tests            Midterm 2, Week 11 Wed"],
    ["12     Nov 16 - Nov 20   Power series                            Quiz 4, Fri Nov 20"],
    [""],
    ["Final exam: Monday, December 14, 8:00am - 10:00am, location TBA."],
    ["Reading: Stewart, Chapter 7 sections 7.1-7.5 before Midterm 1."],
    ["Quiz 3 corrections are due the day after Quiz 3."],
  ]);
  return doc.save();
}

async function cmscSyllabusPdf() {
  const doc = await newPdf();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  let y = 740;
  const lines: [string, boolean?, number?][] = [
    ["CMSC131 Object-Oriented Programming I, Fall 2026", true, 17],
    ["Section 0302  ·  Synthetic syllabus for testing (not a real course page)"],
    ["Projects are submitted on the submit server and are due at 11:59pm Eastern unless noted."],
    [""],
    ["Schedule of projects and exams", true, 13],
    ["Project 3 due Sun Nov 1, 11:59pm"],
    ["Exam 2: Wed Nov 11, 1:00pm - 2:15pm, IRB 0324"],
    ["Exam 2 corrections due one week after Exam 2"],
    ["Project 4 due Fri Nov 13, 11:59pm"],
    ["Quiz 5: Tue Nov 17, in class"],
    ["Project 5 due Fri Dec 4, 11:59pm"],
    ["Final exam: Sat Dec 12, 4:00pm - 6:00pm"],
  ];
  for (const [text, isBold, size] of lines) {
    if (text)
      page.drawText(text, { x: 56, y, size: size ?? 11, font: isBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
    y -= (size ?? 11) + 10;
  }
  return doc.save();
}

/**
 * A syllabus with the patterns real ones use: exams "in-class" with tentative dates (the time comes from the lecture
 * line), a TBA final, a notice rule for exam conflicts, quizzes "in discussion" with no dates, office hours, grade
 * weights, and a topic list. Two pages. No instructor is named.
 */
async function policySyllabusPdf() {
  const doc = await newPdf();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages: [string, boolean?, number?][][] = [
    [
      ["PHYS161 General Physics: Mechanics, Fall 2026", true, 17],
      ["Synthetic syllabus for testing (not a real course page)"],
      ["Lecture: 13:00 - 13:50 (MWF) PHY 1412"],
      ["Office Hours: Tuesday and Thursday, 2:00-3:00 PM (PHY 1201)"],
      ["Discussion: attend the section you registered for."],
      [""],
      ["Quizzes", true, 13],
      ["About 12 short quizzes will be given in discussion during the term."],
      [""],
      ["Exams", true, 13],
      ["There will be two in-class midterms and a common final exam. These dates are TENTATIVE:"],
      ["Midterm 1: October 7, 2026 (Wednesday)"],
      ["Midterm 2: November 18, 2026 (Wednesday)"],
      ["Final exam: TBA"],
      ["The final covers the whole course. Its date will be announced near the end of the term."],
    ],
    [
      ["Exam Policies", true, 13],
      ["Known conflicts: if you have a conflict with an exam date, tell the instructor in writing"],
      ["at least one week (7 days) in advance. Without notice, a missed exam counts as zero."],
      [""],
      ["Grade Distribution", true, 13],
      ["Final Exam - 35%"],
      ["Midterms - 40% (20% each)"],
      ["Quizzes - 15%"],
      ["Labs - 10%"],
      [""],
      ["Topics", true, 13],
      ["1. Vectors and Motion in One Dimension (1-2)"],
      ["2. Motion in Two Dimensions (3-4)"],
      ["3. Newton's Laws (5-6)"],
      ["4. Work and Energy (7-8)"],
      ["5. Momentum and Collisions (9)"],
      ["6. Rotation (10-11)"],
      ["7. Oscillations (14)"],
    ],
  ];
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    let y = 740;
    for (const [text, isBold, size] of lines) {
      if (text)
        page.drawText(text, { x: 56, y, size: size ?? 11, font: isBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
      y -= (size ?? 11) + 10;
    }
  }
  return doc.save();
}

// Photos. Seeded randomness, so `pnpm fixtures` gives the same pixels every time.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Line = { text: string; color?: string; size?: number; strike?: boolean; box?: "empty" | "checked" };

/** Writes lines by hand: each word a little off the baseline and tilted, like marker or pen. */
function handwrite(
  g: SKRSContext2D,
  lines: Line[],
  x: number,
  y: number,
  o: { font: string; size: number; gap: number; color: string; rand: () => number },
) {
  for (const line of lines) {
    const size = line.size ?? o.size;
    g.font = `${size}px "${o.font}"`;
    g.fillStyle = line.color ?? o.color;
    g.strokeStyle = line.color ?? o.color;
    let cx = x + (o.rand() - 0.5) * 10;
    if (line.box) {
      g.lineWidth = 2.5;
      g.strokeRect(cx, y - size * 0.62, size * 0.55, size * 0.55);
      if (line.box === "checked") {
        g.beginPath();
        g.moveTo(cx + 4, y - size * 0.35);
        g.lineTo(cx + size * 0.22, y - size * 0.12);
        g.lineTo(cx + size * 0.62, y - size * 0.8);
        g.stroke();
      }
      cx += size * 0.85;
    }
    const startX = cx;
    for (const word of line.text.split(" ")) {
      const dy = (o.rand() - 0.5) * size * 0.08;
      g.save();
      g.translate(cx, y + dy);
      g.rotate((o.rand() - 0.5) * 0.04);
      g.fillText(word, 0, 0);
      g.restore();
      cx += g.measureText(word + " ").width;
    }
    if (line.strike) {
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(startX - 6, y - size * 0.3);
      g.lineTo(cx, y - size * 0.26 + (o.rand() - 0.5) * 6);
      g.stroke();
    }
    y += o.gap;
  }
}

/** Puts a drawn surface into a photo: background, slight rotation, uneven light, sensor noise. */
function photograph(surface: Canvas, o: { w: number; h: number; bg: string; angle: number; seed: number }) {
  const rand = rng(o.seed);
  const c = createCanvas(o.w, o.h);
  const g = c.getContext("2d");
  g.fillStyle = o.bg;
  g.fillRect(0, 0, o.w, o.h);
  g.save();
  g.translate(o.w / 2, o.h / 2);
  g.rotate(o.angle);
  g.shadowColor = "rgba(0,0,0,0.35)";
  g.shadowBlur = 24;
  g.drawImage(surface, -surface.width / 2, -surface.height / 2);
  g.restore();
  const light = g.createRadialGradient(o.w * 0.35, o.h * 0.3, 50, o.w * 0.5, o.h * 0.5, o.w * 0.8);
  light.addColorStop(0, "rgba(255,255,255,0.18)");
  light.addColorStop(1, "rgba(0,0,0,0.22)");
  g.fillStyle = light;
  g.fillRect(0, 0, o.w, o.h);
  const px = g.getImageData(0, 0, o.w, o.h);
  for (let i = 0; i < px.data.length; i += 4) {
    const n = (rand() - 0.5) * 14;
    px.data[i] += n;
    px.data[i + 1] += n;
    px.data[i + 2] += n;
  }
  g.putImageData(px, 0, 0);
  return c.toBuffer("image/jpeg", 88);
}

function whiteboard(lines: Line[], seed: number, angle: number) {
  const rand = rng(seed);
  const b = createCanvas(1500, 900);
  const g = b.getContext("2d");
  g.fillStyle = "#9aa0a6";
  g.fillRect(0, 0, b.width, b.height);
  const board = g.createLinearGradient(0, 0, b.width, b.height);
  board.addColorStop(0, "#fbfbf8");
  board.addColorStop(0.6, "#eef0ee");
  board.addColorStop(1, "#e3e6e4");
  g.fillStyle = board;
  g.fillRect(18, 18, b.width - 36, b.height - 36);
  // Ghosts of erased writing.
  g.fillStyle = "rgba(120,130,150,0.08)";
  g.font = '60px "Caveat"';
  g.fillText("∫ x e^x dx = x e^x - ∫ e^x dx", 760, 700);
  g.fillText("lim n→∞", 980, 800);
  handwrite(g, lines, 90, 150, { font: "Caveat", size: 72, gap: 135, color: "#1f3a93", rand });
  return photograph(b, { w: 1600, h: 1000, bg: "#c9c2b5", angle, seed });
}

function notebookPage(lines: Line[], seed: number, angle: number, font = "Patrick Hand") {
  const rand = rng(seed);
  const p = createCanvas(1100, 1300);
  const g = p.getContext("2d");
  g.fillStyle = "#fdfdf6";
  g.fillRect(0, 0, p.width, p.height);
  g.strokeStyle = "#b9cbe6";
  g.lineWidth = 2;
  for (let y = 160; y < p.height; y += 70) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(p.width, y);
    g.stroke();
  }
  g.strokeStyle = "#e7a4a4";
  g.beginPath();
  g.moveTo(120, 0);
  g.lineTo(120, p.height);
  g.stroke();
  handwrite(g, lines, 150, 150, { font, size: 50, gap: 140, color: "#1b2a6b", rand });
  return photograph(p, { w: 1300, h: 1500, bg: "#7a5a3c", angle, seed });
}

function stickyNotes(seed: number) {
  const rand = rng(seed);
  const desk = createCanvas(1600, 1100);
  const g = desk.getContext("2d");
  g.fillStyle = "#6b4f36";
  g.fillRect(0, 0, desk.width, desk.height);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(40,25,10,${0.1 + rand() * 0.15})`;
    g.lineWidth = 2 + rand() * 4;
    g.beginPath();
    const y = rand() * desk.height;
    g.moveTo(0, y);
    g.bezierCurveTo(500, y + 20, 1100, y - 20, 1600, y + 10);
    g.stroke();
  }
  // A pen and a laptop corner, so it isn't just notes.
  g.fillStyle = "#222";
  g.fillRect(1250, 820, 280, 24);
  g.fillStyle = "#b7bcc2";
  g.fillRect(-40, 860, 520, 300);
  const notes: { color: string; x: number; y: number; a: number; lines: Line[] }[] = [
    { color: "#fff27a", x: 120, y: 90, a: -0.06, lines: [{ text: "PHYS HW 8" }, { text: "due Fri 11/6" }] },
    { color: "#ffb3c7", x: 610, y: 120, a: 0.05, lines: [{ text: "ENGL peer review" }, { text: "Mon 11/2 in class" }] },
    { color: "#c7f2a4", x: 1110, y: 80, a: -0.03, lines: [{ text: "CMSC131 office hrs" }, { text: "Thu 3-4pm" }] },
    { color: "#a9dcf5", x: 560, y: 560, a: 0.08, lines: [{ text: "buy bluebook" }, { text: "for calc midterm" }] },
  ];
  for (const n of notes) {
    const s = createCanvas(440, 380);
    const sg = s.getContext("2d");
    sg.fillStyle = n.color;
    sg.fillRect(0, 0, 440, 380);
    sg.fillStyle = "rgba(0,0,0,0.06)";
    sg.fillRect(0, 0, 440, 50);
    handwrite(sg, n.lines, 26, 140, { font: "Caveat", size: 52, gap: 90, color: "#222", rand });
    g.save();
    g.translate(n.x + 220, n.y + 190);
    g.rotate(n.a);
    g.shadowColor = "rgba(0,0,0,0.4)";
    g.shadowBlur = 16;
    g.drawImage(s, -220, -190);
    g.restore();
  }
  return photograph(desk, { w: 1600, h: 1100, bg: "#6b4f36", angle: 0, seed });
}

/** A JPEG with an EXIF capture time (DateTimeOriginal + OffsetTimeOriginal), as a phone camera writes it. */
function withCaptureTime(jpeg: Buffer, taken: string, offset: string): Buffer {
  const ascii = (s: string) => Buffer.from(s + "\0", "ascii");
  const date = ascii(taken); // "2026:11:01 21:40:00", 20 bytes
  const off = ascii(offset); // "-05:00", 7 bytes
  const tiff = Buffer.alloc(56 + date.length + off.length);
  tiff.write("MM", 0, "ascii");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  // IFD0: one entry, the pointer to the Exif IFD at 26.
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x8769, 10);
  tiff.writeUInt16BE(4, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt32BE(26, 18);
  tiff.writeUInt32BE(0, 22);
  // Exif IFD: DateTimeOriginal and OffsetTimeOriginal, both ASCII, stored after the IFD.
  tiff.writeUInt16BE(2, 26);
  tiff.writeUInt16BE(0x9003, 28);
  tiff.writeUInt16BE(2, 30);
  tiff.writeUInt32BE(date.length, 32);
  tiff.writeUInt32BE(56, 36);
  tiff.writeUInt16BE(0x9011, 40);
  tiff.writeUInt16BE(2, 42);
  tiff.writeUInt32BE(off.length, 44);
  tiff.writeUInt32BE(56 + date.length, 48);
  tiff.writeUInt32BE(0, 52);
  date.copy(tiff, 56);
  off.copy(tiff, 56 + date.length);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)]);
}

/**
 * A dorm wall, for the demo video: a painted cinder-block wall with a small whiteboard, fifteen sticky notes pinned and
 * taped around it, and the corner of a printed schedule. Everything on it is made up.
 */
function dormWall(seed: number) {
  const rand = rng(seed);
  const W = 2000,
    H = 1400;
  const wall = createCanvas(W, H);
  const g = wall.getContext("2d");
  // Painted cinder block: cream, each block a shade off, mortar lines a little darker.
  g.fillStyle = "#e8e1d2";
  g.fillRect(0, 0, W, H);
  const bw = 390,
    bh = 195;
  for (let row = 0; row * bh < H; row++)
    for (let col = -1; col * bw < W; col++) {
      const x = col * bw + (row % 2 ? bw / 2 : 0);
      const y = row * bh;
      const shade = 226 + Math.round((rand() - 0.5) * 8);
      g.fillStyle = `rgb(${shade + 6},${shade},${shade - 12})`;
      g.fillRect(x + 4, y + 4, bw - 8, bh - 8);
    }
  // Paint texture.
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(90,70,40,${rand() * 0.05})`;
    g.fillRect(rand() * W, rand() * H, 2, 2);
  }

  const pinned = (surface: Canvas, x: number, y: number, a: number, how: "pin" | "tape", colour = "#c0392b") => {
    g.save();
    g.translate(x + surface.width / 2, y + surface.height / 2);
    g.rotate(a);
    g.shadowColor = "rgba(40,30,20,0.38)";
    g.shadowBlur = 18;
    g.shadowOffsetX = 6;
    g.shadowOffsetY = 9;
    g.drawImage(surface, -surface.width / 2, -surface.height / 2);
    g.shadowColor = "transparent";
    if (how === "pin") {
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.beginPath();
      g.arc(4, -surface.height / 2 + 30, 13, 0, Math.PI * 2);
      g.fill();
      const head = g.createRadialGradient(-4, -surface.height / 2 + 22, 2, 0, -surface.height / 2 + 26, 13);
      head.addColorStop(0, "#ffffff");
      head.addColorStop(0.25, colour);
      head.addColorStop(1, "#3b0d0d");
      g.fillStyle = head;
      g.beginPath();
      g.arc(0, -surface.height / 2 + 26, 13, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = "rgba(245,240,220,0.55)";
      g.save();
      g.rotate((rand() - 0.5) * 0.3);
      g.fillRect(-55, -surface.height / 2 - 18, 110, 38);
      g.restore();
    }
    g.restore();
  };

  // The whiteboard, small and framed, with this week on it.
  const board = createCanvas(820, 540);
  {
    const b = board.getContext("2d");
    b.fillStyle = "#b9bec4";
    b.fillRect(0, 0, 820, 540);
    const face = b.createLinearGradient(0, 0, 820, 540);
    face.addColorStop(0, "#fdfdfb");
    face.addColorStop(1, "#e9ecea");
    b.fillStyle = face;
    b.fillRect(14, 14, 792, 512);
    b.fillStyle = "rgba(110,120,140,0.09)";
    b.font = '48px "Caveat"';
    b.fillText("dx/dt = 3t^2", 470, 470);
    handwrite(b, [{ text: "THIS WEEK", color: "#b0272f", size: 74 }], 60, 110, { font: "Caveat", size: 74, gap: 100, color: "#b0272f", rand }); // prettier-ignore
    handwrite(
      b,
      [
        { text: "CHEM131 quiz 2 - Mon 11/2" },
        { text: "HIST200 outline due Wed 11/4" },
        { text: "MATH141 HW 7 due Fri 11/6" },
      ],
      60,
      225,
      { font: "Caveat", size: 58, gap: 92, color: "#1f3a93", rand },
    );
  }
  pinned(board, 560, 120, -0.012, "tape");

  // The corner of a printed weekly schedule, taped at the right edge and running off the photo.
  const sheet = createCanvas(560, 760);
  {
    const s = sheet.getContext("2d");
    s.fillStyle = "#fbfbf7";
    s.fillRect(0, 0, 560, 760);
    s.fillStyle = "#1b1b1b";
    s.font = "bold 26px Helvetica";
    s.fillText("Fall 2026 · Weekly", 28, 52);
    s.strokeStyle = "#cfcfcf";
    s.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      s.beginPath();
      s.moveTo(28, 90 + i * 72);
      s.lineTo(560, 90 + i * 72);
      s.stroke();
    }
    s.font = "18px Helvetica";
    s.fillStyle = "#555";
    ["8am", "9am", "10am", "11am", "12pm", "1pm", "2pm", "3pm"].forEach((t, i) => s.fillText(t, 28, 96 + i * 72));
    s.fillStyle = "#cfe3f6";
    s.fillRect(110, 236, 200, 66);
    s.fillStyle = "#f6dcc4";
    s.fillRect(330, 380, 200, 100);
    s.fillStyle = "#1b1b1b";
    s.font = "bold 18px Helvetica";
    s.fillText("MATH141", 120, 262);
    s.fillText("CHEM131", 340, 406);
  }
  pinned(sheet, 1640, 610, 0.035, "tape");

  // Fifteen sticky notes around the board.
  const notes: { colour: string; lines: string[] }[] = [
    { colour: "#fff27a", lines: ["PHYS161 HW 9", "due Fri 11/6"] },
    { colour: "#ffb3c7", lines: ["ENGL101 draft 2", "due Thu 11/5 9am"] },
    { colour: "#c7f2a4", lines: ["CMSC131 proj 4", "due Mon 11/9 11pm"] },
    { colour: "#a9dcf5", lines: ["MATH141 quiz 4", "Thu 11/5 in class"] },
    { colour: "#ffc98a", lines: ["career fair", "Wed 11/4 10am-3pm"] },
    { colour: "#fff27a", lines: ["MATH office hrs", "Tue 11/3 2-3pm"] },
    { colour: "#ffb3c7", lines: ["return library", "books by Sat 11/7"] },
    { colour: "#c7f2a4", lines: ["flu shot", "Fri 11/6 1pm"] },
    { colour: "#a9dcf5", lines: ["HIST200 ch. 6", "read by Wed 11/4"] },
    { colour: "#fff27a", lines: ["STAT400 exam 2", "Thu 11/12"] },
    { colour: "#ffc98a", lines: ["call mom", "Sun 11/8"] },
    { colour: "#c7f2a4", lines: ["club mtg", "Wed 11/4 7pm"] },
    { colour: "#ffb3c7", lines: ["laundry!!"] },
    { colour: "#a9dcf5", lines: ["CHEM lab report", "due Tue 11/10"] },
    { colour: "#fff27a", lines: ["buy bluebook"] },
  ];
  const spots: [number, number][] = [
    [90, 110], [90, 420], [90, 730], [90, 1040], [330, 900],
    [560, 720], [800, 760], [1040, 720], [1280, 760], [570, 1040],
    [830, 1060], [1090, 1030], [1420, 120], [1420, 400], [1330, 1060],
  ]; // prettier-ignore
  notes.forEach((n, i) => {
    const s = createCanvas(240, 240);
    const sg = s.getContext("2d");
    sg.fillStyle = n.colour;
    sg.fillRect(0, 0, 240, 240);
    sg.fillStyle = "rgba(0,0,0,0.07)";
    sg.fillRect(0, 0, 240, 34);
    const curl = sg.createLinearGradient(170, 170, 240, 240);
    curl.addColorStop(0, "rgba(0,0,0,0)");
    curl.addColorStop(1, "rgba(0,0,0,0.12)");
    sg.fillStyle = curl;
    sg.fillRect(0, 0, 240, 240);
    // The writing fits the note, with room to spare: the longest line sets the size.
    sg.font = '40px "Caveat"';
    const widest = Math.max(...n.lines.map((l) => sg.measureText(l).width));
    const size = Math.min(42, Math.floor((40 * 196) / widest));
    handwrite(sg, n.lines.map((text) => ({ text })), 16, 100, { font: "Caveat", size, gap: 64, color: "#1d1d1d", rand }); // prettier-ignore
    const [x, y] = spots[i];
    const pins = ["#c0392b", "#1f6fb2", "#2e8b57", "#d4a017"];
    pinned(s, x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 30, (rand() - 0.5) * 0.18, i % 3 === 0 ? "tape" : "pin", pins[i % 4]); // prettier-ignore
  });

  const jpeg = photograph(wall, { w: W, h: H, bg: "#d8d0c0", angle: 0.008, seed });
  return withCaptureTime(jpeg, "2026:11:01 21:40:00", "-05:00");
}

writeFileSync(join(OUT, "testudo-schedule.png"), scheduleScreenshot());
writeFileSync(join(OUT, "testudo-grid.png"), scheduleScreenshot({ list: false }));
writeFileSync(join(OUT, "testudo-grid-blocks.png"), scheduleScreenshot({ list: false, times: false }));
writeFileSync(join(OUT, "testudo-grid-popup.png"), scheduleScreenshot({ list: false, times: false, popup: true }));
writeFileSync(
  join(OUT, "testudo-grid-short-day.png"),
  scheduleScreenshot({ list: false, times: false, tooltip: true, courses: SHORT_THURSDAY }),
);
writeFileSync(join(OUT, "syllabus-cmsc131.pdf"), await cmscSyllabusPdf());
writeFileSync(join(OUT, "syllabus-phys161-policies.pdf"), await policySyllabusPdf());
writeFileSync(
  join(OUT, "whiteboard-math141.jpg"),
  whiteboard(
    [
      { text: "MATH 141 - this week", color: "#222", size: 80 },
      { text: "Quiz Fri: improper integrals" },
      { text: "PS5 graded - pick up in discussion", color: "#222" },
      { text: "Read 7.8 before Wed" },
    ],
    11,
    0.015,
  ),
);
// Deliberate conflict 1: the syllabus says Quiz 3 is Fri Oct 30; this board, photographed Wed Oct 28, moves it.
writeFileSync(
  join(OUT, "whiteboard-quiz-moved.jpg"),
  whiteboard(
    [
      { text: "MATH141    Wed 10/28", color: "#222", size: 80 },
      { text: "Quiz moved to Mon!", color: "#b3261e" },
      { text: "PS6 due Thu 11/5" },
      { text: "Office hours today 2-3pm", color: "#222" },
    ],
    23,
    -0.02,
  ),
);
writeFileSync(
  join(OUT, "notes-week.jpg"),
  notebookPage(
    [
      { text: "This week", size: 62 },
      { text: "PHYS161 lab report - Tue 10/27 11:59pm", box: "empty" },
      { text: "ENGL101 draft due Wed", box: "checked", strike: true },
      { text: "ENGL101 draft - Fri 10/30 5pm", box: "empty" },
      { text: "call advisor re: spring registration", box: "empty" },
      { text: "calc PS6 - Thu 11/5", box: "empty" },
    ],
    37,
    0.025,
  ),
);
// Deliberate conflict 2: the CMSC131 syllabus says Project 4 is due 11:59pm; these notes, from Wed Oct 28, say 5pm.
writeFileSync(
  join(OUT, "notes-cmsc131.jpg"),
  notebookPage(
    [
      { text: "CMSC131 lab notes 10/28", size: 60 },
      { text: "- Proj 3 due Sun 11/1 11:59pm" },
      { text: "- Proj 4 due Fri 11/13 @ 5pm (per TA)" },
      { text: "- review recursion slides before Exam 2" },
    ],
    41,
    -0.03,
    "Caveat",
  ),
);
writeFileSync(join(OUT, "sticky-notes.jpg"), stickyNotes(53));
writeFileSync(join(OUT, "dorm-wall.jpg"), dormWall(71));
// A course site's to-do list (Canvas/ELMS style, no real branding), screenshotted on a phone-sized window.
function lmsScreenshot() {
  const W = 1170,
    H = 1500;
  const c = createCanvas(W, H);
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#2d3b45";
  g.fillRect(0, 0, W, 110);
  g.fillStyle = "#ffffff";
  g.font = "bold 40px Helvetica";
  g.fillText("To Do", 40, 72);
  g.font = "24px Helvetica";
  g.fillText("Course site (sample data)", W - 330, 70);
  const rows = [
    { course: "MATH141 Calculus II", title: "Problem Set 6", due: "Due Nov 5 at 11:59pm", pts: "10 pts" },
    { course: "ENGL101 Academic Writing", title: "Essay 2 draft", due: "Due Nov 6 at 11:59pm", pts: "20 pts" },
    { course: "CMSC131 OOP I", title: "Project 4", due: "Due Nov 9 at 11:00pm", pts: "50 pts" },
    { course: "HIST200 Interpreting History", title: "Reading response 7", due: "Due Nov 10", pts: "5 pts" },
    { course: "MATH141 Calculus II", title: "Quiz 4", due: "Due Nov 12 at 10am", pts: "15 pts" },
  ];
  rows.forEach((r, i) => {
    const y = 150 + i * 250;
    g.fillStyle = "#f5f5f5";
    g.fillRect(30, y, W - 60, 220);
    g.fillStyle = "#0374b5";
    g.fillRect(30, y, 10, 220);
    g.fillStyle = "#6b7780";
    g.font = "26px Helvetica";
    g.fillText(r.course, 70, y + 50);
    g.fillStyle = "#2d3b45";
    g.font = "bold 36px Helvetica";
    g.fillText(r.title, 70, y + 105);
    g.fillStyle = "#2d3b45";
    g.font = "28px Helvetica";
    g.fillText(`${r.due}  |  ${r.pts}`, 70, y + 165);
  });
  return c.toBuffer("image/png");
}
writeFileSync(join(OUT, "canvas-todo.png"), lmsScreenshot());

// A whiteboard photo too blurry to read with confidence: Lens should ask, not guess.
async function blurred(jpeg: Buffer, px: number) {
  const img = await loadImage(jpeg);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.filter = `blur(${px}px)`;
  g.drawImage(img, 0, 0);
  return c.toBuffer("image/jpeg", 85);
}
writeFileSync(
  join(OUT, "whiteboard-blurry.jpg"),
  await blurred(
    whiteboard(
      [
        { text: "MATH141   Fri 10/30", color: "#222", size: 80 },
        { text: "Quiz 4 Thu 11/12" },
        { text: "PS7 due Mon 11/9" },
      ],
      31,
      0.03,
    ),
    11,
  ),
);
writeFileSync(join(OUT, "testudo-schedule.txt"), scheduleText());
writeFileSync(join(OUT, "syllabus-math141.pdf"), await syllabusPdf());

// What each fixture is, and when the photos were "taken" (Eastern time). Evals read this.
const manifest = {
  "testudo-schedule.png": { kind: "testudo_screenshot", label: "Testudo screenshot", captured_at: null },
  "testudo-schedule.txt": { kind: "testudo_text", label: "pasted Testudo schedule", captured_at: null },
  "testudo-grid.png": { kind: "testudo_screenshot", label: "Testudo screenshot", captured_at: null },
  "testudo-grid-blocks.png": { kind: "testudo_screenshot", label: "Testudo screenshot", captured_at: null },
  "testudo-grid-popup.png": { kind: "testudo_screenshot", label: "Testudo screenshot", captured_at: null },
  "testudo-grid-short-day.png": { kind: "testudo_screenshot", label: "Testudo screenshot", captured_at: null },
  "syllabus-math141.pdf": { kind: "syllabus_pdf", label: "MATH141 syllabus", captured_at: null },
  "syllabus-cmsc131.pdf": { kind: "syllabus_pdf", label: "CMSC131 syllabus", captured_at: null },
  "syllabus-phys161-policies.pdf": { kind: "syllabus_pdf", label: "PHYS161 syllabus", captured_at: null },
  "whiteboard-math141.jpg": {
    kind: "whiteboard_photo",
    label: "whiteboard photo",
    captured_at: "2026-10-26T10:52:00-04:00",
  },
  "whiteboard-quiz-moved.jpg": {
    kind: "whiteboard_photo",
    label: "whiteboard photo",
    captured_at: "2026-10-28T10:51:00-04:00",
  },
  "notes-week.jpg": { kind: "notes_photo", label: "notes photo", captured_at: "2026-10-25T20:15:00-04:00" },
  "notes-cmsc131.jpg": { kind: "notes_photo", label: "notes photo", captured_at: "2026-10-28T16:40:00-04:00" },
  "sticky-notes.jpg": { kind: "notes_photo", label: "sticky notes photo", captured_at: "2026-10-29T08:30:00-04:00" },
  "canvas-todo.png": { kind: "lms_screenshot", label: "course site screenshot", captured_at: null },
  "dorm-wall.jpg": { kind: "notes_photo", label: "dorm wall photo", captured_at: "2026-11-01T21:40:00-05:00" },
  "whiteboard-blurry.jpg": {
    kind: "whiteboard_photo",
    label: "whiteboard photo",
    captured_at: "2026-10-30T10:50:00-04:00",
  },
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote fixtures to ${OUT}`);
