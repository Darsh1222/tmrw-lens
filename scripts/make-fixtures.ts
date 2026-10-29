// Writes the synthetic fixtures in fixtures/synthetic/. Everything here is made
// up: no real student, schedule, or syllabus. Run with `pnpm fixtures`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUT = join(import.meta.dirname, "..", "fixtures", "synthetic");
mkdirSync(OUT, { recursive: true });

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

function scheduleScreenshot() {
  const W = 1600,
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
  for (const course of COURSES)
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
        g.fillText(`${m.start}-${m.end}`, x + 8, top + 38);
        if (height > 60) g.fillText(m.room, x + 8, top + 55);
      }

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

async function syllabusPdf() {
  const doc = await PDFDocument.create();
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
  ]);
  return doc.save();
}

writeFileSync(join(OUT, "testudo-schedule.png"), scheduleScreenshot());
writeFileSync(join(OUT, "testudo-schedule.txt"), scheduleText());
writeFileSync(join(OUT, "syllabus-math141.pdf"), await syllabusPdf());
console.log(`Wrote fixtures to ${OUT}`);
