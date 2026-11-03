import { expect, test, type Page } from "@playwright/test";

// One test per screen. Each checks no console errors, no sideways scroll, and
// a layout shift near zero, then saves a full-page screenshot.

const FIXTURES = new URL("../../fixtures/synthetic/", import.meta.url).pathname;

async function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Mocked 4xx/5xx responses log a network line; that's the state under test, not a bug.
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text())); // prettier-ignore
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  return errors;
}

async function check(page: Page, errors: string[], name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(errors, "console errors").toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll").toBe(true); // prettier-ignore
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls), "layout shift").toBeLessThan(0.05);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

async function sample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample week" }).click();
  await page.getByRole("heading", { name: "What Lens found." }).waitFor();
  await page.waitForTimeout(2000); // the outlines draw
  // The plan's cards only arrive once the plan is in view, as for a person scrolling down.
  await page.getByRole("heading", { name: "Your plan" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 300);
  await expect(page.locator('section[aria-labelledby="plan-title"] [data-anim]')).toHaveAttribute("data-anim", /playing|done/, { timeout: 5000 }); // prettier-ignore
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
}

test("home and hero", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("rebuilt");
  await page.waitForTimeout(600);
  await check(page, errors, "home");
});

test("upload, with files ready", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles([`${FIXTURES}whiteboard-quiz-moved.jpg`, `${FIXTURES}syllabus-math141.pdf`]); // prettier-ignore
  await expect(page.getByText(/Read all 2/)).toBeVisible({ timeout: 20000 });
  await check(page, errors, "upload-ready");
});

test("upload, past today's limit", async ({ page }) => {
  const errors = await watch(page);
  await page.route("**/api/read", (r) => r.fulfill({ status: 429, json: { code: "user_limit", error: "That's all the free reading for today. Come back tomorrow; the sample week is always free." } })); // prettier-ignore
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(`${FIXTURES}whiteboard-quiz-moved.jpg`);
  await page.getByRole("button", { name: /Read it/ }).click();
  await expect(page.getByText(/Come back tomorrow/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try the sample week instead" })).toBeVisible();
  await check(page, errors, "upload-rate-limited");
});

test("upload, the model failed", async ({ page }) => {
  const errors = await watch(page);
  await page.route("**/api/read", (r) => r.fulfill({ status: 502, json: { error: "The model didn't answer properly. Try this page again." } })); // prettier-ignore
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(`${FIXTURES}whiteboard-quiz-moved.jpg`);
  await page.getByRole("button", { name: /Read it/ }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await check(page, errors, "upload-error");
});

test("results: plan, question, send", async ({ page }) => {
  const errors = await watch(page);
  await sample(page);
  await expect(page.getByRole("form", { name: "A question" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Send to Tomorrow" })).toBeVisible();
  await check(page, errors, "results");
});

test("results: semester view", async ({ page }) => {
  const errors = await watch(page);
  await sample(page);
  await page.getByRole("radio", { name: "semester" }).click();
  await expect(page.getByRole("group", { name: "The semester" })).toBeVisible();
  await check(page, errors, "results-semester");
});

test("evidence drawer", async ({ page }) => {
  const errors = await watch(page);
  await sample(page);
  await page.locator("[data-item]:visible").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Date math")).toBeVisible();
  await page.waitForTimeout(400);
  await check(page, errors, "evidence-drawer");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-drawer="closed"]')).toBeAttached();
});

test("answering the question with the keyboard", async ({ page }) => {
  const errors = await watch(page);
  await sample(page);
  const answer = page.getByRole("button", { name: "Answer" });
  await answer.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Question 2 of|No questions left/)).toBeVisible();
  await check(page, errors, "answered");
});

test("missed session, played", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/");
  const panel = page.locator("#missed-session");
  await panel.getByRole("button", { name: /^Play: miss/ }).click();
  await expect(panel.getByRole("button", { name: "Play again" })).toBeVisible({ timeout: 30000 });
  await expect(panel.getByText(/changed 1 · unchanged 7/)).toBeVisible();
  await check(page, errors, "missed-session");
});

test("evals page", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/evals");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  await check(page, errors, "evals");
});

test("not found", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/nowhere");
  await expect(page.getByRole("heading", { name: /nothing at this address/ })).toBeVisible();
  await check(page, errors, "not-found");
});

test("expired review link", async ({ page }) => {
  const errors = await watch(page);
  await page.goto("/review/not-a-real-token");
  await expect(page.getByText(/expired/)).toBeVisible();
  await check(page, errors, "review-expired");
});
