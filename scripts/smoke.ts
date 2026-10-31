// Live smoke test against Meta Model API: text, image, PDF page (rendered and
// native), and SAM. Uses the synthetic fixtures only. Run with `pnpm smoke`
// (reads META_API_KEY from .env.local). Costs a few cents.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readEnv } from "@/lib/env";
import { createResponse, type CallResult } from "@/lib/meta/client";
import { segmentImage } from "@/lib/meta/sam";
import { runTask } from "@/lib/meta/task";
import { ScheduleExtraction, SyllabusPageExtraction } from "@/lib/schemas/extraction";
import { renderPdfPages } from "./lib/render-pdf";

const FIX = join(import.meta.dirname, "..", "fixtures", "synthetic");
const env = readEnv();
const calls: { name: string; call: CallResult }[] = [];
const quiet = () => {};

const dataUrl = (bytes: Buffer, mime: string) => `data:${mime};base64,${bytes.toString("base64")}`;

function report(name: string, call: CallResult, detail: string) {
  calls.push({ name, call });
  const u = call.usage;
  console.log(
    `✓ ${name}: ${detail}\n    ${call.latencyMs}ms, ${call.attempts} attempt(s), in ${u.input_tokens} (cached ${u.cached_tokens}), out ${u.output_tokens} (reasoning ${u.reasoning_tokens}), $${call.costUsd.toFixed(5)}`,
  );
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.log(`✗ ${name}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    process.exitCode = 1;
  }
}

const SMOKE_INSTRUCTIONS = (what: string) =>
  `Smoke test. Extract ${what} from the image. Copy every quote character for character. Boxes are [x_min, y_min, x_max, y_max] on a 0-1000 grid, origin top-left. Leave dates and times exactly as written.`;

console.log(`Model ${env.MUSE_SPARK_MODEL}, SAM ${env.SAM_MODEL}, base ${env.META_API_BASE_URL}\n`);

await step("text", async () => {
  const call = await createResponse(
    {
      model: env.MUSE_SPARK_MODEL,
      input: "Reply with exactly: ok",
      reasoning: { effort: "minimal" },
      max_output_tokens: 2_000,
    },
    { task: "smoke_text", log: quiet },
  );
  report("text", call, JSON.stringify(call.outputText.trim()));
});

const schedulePng = readFileSync(join(FIX, "testudo-schedule.png"));
await step("image (Testudo screenshot → ScheduleExtraction)", async () => {
  const { data, calls: c } = await runTask(
    {
      name: "smoke_schedule",
      version: 1,
      instructions: SMOKE_INSTRUCTIONS("every class meeting"),
      schema: ScheduleExtraction,
      maxOutputTokens: 12_000,
    },
    [{ type: "input_image", image_url: dataUrl(schedulePng, "image/png") }],
    { log: quiet },
  );
  const first = data.classes[0];
  report(
    "image",
    c.at(-1)!,
    `view=${data.view}, ${data.classes.length} meetings; first: ${first?.course_code} ${first?.meeting_type} ${first?.days_text} ${first?.start_text}-${first?.end_text} box=${JSON.stringify(first?.evidence.box)}`,
  );
});

const pdf = readFileSync(join(FIX, "syllabus-math141.pdf"));
await step("PDF page 2 (rendered PNG → SyllabusPageExtraction)", async () => {
  const [page] = await renderPdfPages(new Uint8Array(pdf), { pages: [2] });
  const { data, calls: c } = await runTask(
    {
      name: "smoke_syllabus_page",
      version: 1,
      instructions: SMOKE_INSTRUCTIONS("every dated item (exams, quizzes, assignments, readings)"),
      schema: SyllabusPageExtraction,
      maxOutputTokens: 12_000,
    },
    [{ type: "input_image", image_url: dataUrl(page.png, "image/png") }],
    { log: quiet },
  );
  report(
    "pdf page (rendered)",
    c.at(-1)!,
    `${data.items.length} items: ${data.items.map((i) => `${i.title} [${i.date_text ?? "-"}]`).join("; ")}`,
  );
});

await step("PDF native (input_file → SyllabusPageExtraction)", async () => {
  const { data, calls: c } = await runTask(
    {
      name: "smoke_syllabus_native",
      version: 1,
      instructions: SMOKE_INSTRUCTIONS("every dated item (exams, quizzes, assignments, readings) from all pages"),
      schema: SyllabusPageExtraction,
      maxOutputTokens: 12_000,
    },
    [{ type: "input_file", filename: "syllabus.pdf", file_data: dataUrl(pdf, "application/pdf") }],
    { log: quiet },
  );
  report(
    "pdf native",
    c.at(-1)!,
    `${data.items.length} items, term start ${JSON.stringify(data.term_start?.date_text ?? null)}`,
  );
});

for (const phrase of ["table", "text block"]) {
  await step(`SAM "${phrase}"`, async () => {
    const { objects: boxes, call } = await segmentImage(dataUrl(schedulePng, "image/png"), phrase, { log: quiet });
    const top = boxes
      .slice(0, 3)
      .map(
        (b) => `[${[b.bbox.x0, b.bbox.y0, b.bbox.x1, b.bbox.y1].map((v) => v.toFixed(2)).join(",")}] c=${b.confidence}`,
      )
      .join(" ");
    report(`sam "${phrase}"`, call, `${boxes.length} boxes ${top}`);
  });
}

const total = calls.reduce((s, c) => s + c.call.costUsd, 0);
console.log(`\n${calls.length} calls, $${total.toFixed(4)} total`);
