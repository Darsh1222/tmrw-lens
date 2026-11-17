import { expect, test } from "@playwright/test";

// The judge's path: the two buttons at the top each show the product in about 10 seconds, free. Neither may call a
// model: the sample week is recorded readings, and a missed session with its own reply is its recorded run.

const lightOnly = () =>
  test.skip(!test.info().project.name.startsWith("light"), "the path is the same in either theme");

test("Course material opens the recorded evidence without model calls", async ({ page }) => {
  lightOnly();
  const calls: string[] = [];
  page.on("request", (r) => /\/api\/(read|rebuild|extract)/.test(r.url()) && calls.push(r.url()));
  await page.goto("/#sample-week");
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible({ timeout: 15_000 });
  expect(calls).toEqual([]);
});

test("The home workspace previews and applies a real checked recovery", async ({ page }) => {
  lightOnly();
  await page.goto("/");
  const schedule = page.getByRole("region", { name: "Your changing schedule" });
  await expect(schedule).toHaveAttribute("data-phase", "before");
  await page.getByRole("button", { name: "Find a time that fits", exact: true }).click();
  await expect(schedule).toHaveAttribute("data-phase", "preview");
  await page.getByRole("button", { name: "Use this plan", exact: true }).click();
  await expect(schedule).toHaveAttribute("data-phase", "active");
  await expect(page.getByRole("button", { name: "Finished this step", exact: true })).toBeVisible();
});

test("Send remembers the Tomorrow token after a send it accepts, and forgets it on a 401", async ({ page }) => {
  lightOnly();
  let status = 200;
  await page.route("**/api/send", (r) =>
    r.fulfill(
      status === 200
        ? { status: 200, json: { created: { a: "t1" }, skipped_duplicates: [] } }
        : {
            status: 401,
            json: { error: "Tomorrow didn't accept that token. Copy a new one from Tomorrow's Settings." },
          },
    ),
  );
  await page.goto("/#sample-week");
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible({ timeout: 15_000 });
  await page.getByText("Connect the Tomorrow assistant", { exact: false }).click();
  await page.getByLabel("Lens token").fill("lens_test_token_123");
  await page.getByRole("button", { name: /^Send \d+/ }).click();
  await expect(page.getByText("Connected to Tomorrow")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("lens_tomorrow_token"))).toBe("lens_test_token_123");

  status = 401;
  await page.getByRole("button", { name: /^Send \d+/ }).click();
  await expect(page.getByRole("region", { name: "Ready to make room for the work?" }).getByRole("alert")).toContainText(
    "didn't accept that token",
  );
  await expect(page.getByLabel("Lens token")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("lens_tomorrow_token"))).toBeNull();

  status = 200;
  await page.getByLabel("Lens token").fill("lens_test_token_456");
  await page.getByRole("button", { name: /^Send \d+/ }).click();
  await page.getByRole("button", { name: "Forget token" }).click();
  await expect(page.getByLabel("Lens token")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("lens_tomorrow_token"))).toBeNull();
});

test("the top bar opens a personal task and the mobile menu closes with Escape", async ({ page }) => {
  lightOnly();
  await page.goto("/");
  const bar = page.getByRole("banner");
  await expect(bar.getByRole("link", { name: "Plan a task" })).toBeVisible();
  if (test.info().project.name.endsWith("mobile")) {
    await bar.getByRole("button", { name: "Open menu" }).click();
    await expect(page.locator("#nav-menu").getByRole("link", { name: "Course material" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#nav-menu")).toHaveCount(0);
  }
  await bar.getByRole("link", { name: "Plan a task" }).click();
  await expect(page.getByRole("heading", { name: "What needs doing?" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("keyboard navigation moves between workspace tabs", async ({ page }) => {
  lightOnly();
  await page.goto("/");
  await page.getByRole("tab", { name: "Your week", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Course material", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Course material", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Your week", exact: true })).toBeFocused();
});

test("Add to calendar downloads the verified plan as an .ics file", async ({ page }) => {
  lightOnly();
  await page.goto("/#sample-week");
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible({ timeout: 15_000 });
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export confirmed dates" }).click()]); // prettier-ignore
  expect(file.suggestedFilename()).toBe("lens-plan.ics");
  const text = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(text).toMatch(/^BEGIN:VCALENDAR\r\n/);
  expect(text).toContain("RRULE:FREQ=WEEKLY");
});

test("files with their own text: a calendar is read in code; Word goes as text, never as a picture", async ({
  page,
}) => {
  lightOnly();
  const reads: { text: boolean; image: boolean }[] = [];
  await page.route("**/api/read", async (r) => {
    const body = r.request().postDataBuffer()?.toString("latin1") ?? "";
    reads.push({ text: /name="text"/.test(body), image: /name="image"/.test(body) });
    await r.fulfill({ status: 502, json: { error: "The model didn't answer properly. Try this page again." } });
  });
  await page.goto("/?tab=sources");
  const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:MATH141 Exam 2", "DTSTART;TZID=America/New_York:20261111T150000", "DTEND;TZID=America/New_York:20261111T161500", "END:VEVENT", "END:VCALENDAR"].join("\r\n"); // prettier-ignore
  await page.locator('input[type="file"]').setInputFiles({ name: "math141.ics", mimeType: "text/calendar", buffer: Buffer.from(ics) }); // prettier-ignore
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("MATH141 Exam 2").first()).toBeAttached();
  expect(reads).toEqual([]);

  const { zipSync, strToU8 } = await import("fflate");
  const docx = zipSync({ "word/document.xml": strToU8("<w:document><w:body><w:p><w:r><w:t>STAT400 Homework 1 due Thursday, September 17, 2026 at 11:59pm</w:t></w:r></w:p></w:body></w:document>") }); // prettier-ignore
  await page.locator('input[type="file"]').setInputFiles({ name: "syllabus.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from(docx) }); // prettier-ignore
  await expect.poll(() => reads.length, { timeout: 15_000 }).toBe(1);
  expect(reads[0]).toEqual({ text: true, image: false });
});
