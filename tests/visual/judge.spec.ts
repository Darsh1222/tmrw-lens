import { expect, test } from "@playwright/test";

// The judge's path: the two buttons at the top each show the product in about 10 seconds, free. Neither may call a
// model: the sample week is recorded readings, and a missed session with its own reply is its recorded run.

const lightOnly = () =>
  test.skip(!test.info().project.name.startsWith("light"), "the path is the same in either theme");

test("Step 2, See the proof: opens the recorded week and its plan, with no model calls", async ({ page }) => {
  lightOnly();
  const calls: string[] = [];
  page.on("request", (r) => /\/api\/(read|rebuild|extract)/.test(r.url()) && calls.push(r.url()));
  await page.goto("/");
  await page.getByRole("link", { name: /See the proof/ }).click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible({ timeout: 15_000 });
  expect(calls).toEqual([]);
});

test("Try a missed session: plays the recorded rebuild to its message, with no model calls", async ({ page }) => {
  lightOnly();
  const calls: string[] = [];
  page.on("request", (r) => /\/api\/(read|rebuild|extract)/.test(r.url()) && calls.push(r.url()));
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Try a missed session", exact: true }).click();
  const panel = page.locator("#missed-session [data-anim]").first();
  await expect(panel).toHaveAttribute("data-anim", "done", { timeout: 20_000 });
  await expect(page.locator("#missed-session")).toContainText("Nothing else changed.");
  expect(calls).toEqual([]);
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
  await page.getByLabel("Lens token").fill("lens_test_token_123");
  await page.getByRole("button", { name: /^Send \d+/ }).click();
  await expect(page.getByText("Connected to Tomorrow")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("lens_tomorrow_token"))).toBe("lens_test_token_123");

  status = 401;
  await page.getByRole("button", { name: /^Send \d+/ }).click();
  await expect(page.getByRole("region", { name: "Send to Tomorrow" }).getByRole("alert")).toContainText(
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

test("the top bar: section links underline the section in view; the primary action is always there", async ({
  page,
}) => {
  lightOnly();
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  const bar = page.getByRole("banner");
  await expect(bar.getByRole("link", { name: "Try a missed session" })).toBeVisible();
  const mobile = test.info().project.name.endsWith("mobile");
  if (mobile) {
    await bar.getByRole("button", { name: "Open menu" }).click();
    const menu = page.locator("#nav-menu");
    await expect(menu.getByRole("link", { name: "Results" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await bar.getByRole("button", { name: "Open menu" }).click();
    await menu.getByRole("link", { name: "Results" }).click();
    await expect(menu).toHaveCount(0);
  } else {
    await bar.getByRole("link", { name: "Results" }).click();
  }
  await expect(page.locator("#results")).toBeInViewport();
  if (!mobile) await expect(bar.getByRole("link", { name: "Results" })).toHaveAttribute("aria-current", "true");
  // "How to try it" step 3 jumps to the drop zone and outlines it for a moment.
  await page.getByRole("link", { name: /Use your own/ }).click();
  await expect(page.locator("#upload")).toHaveAttribute("data-flash", "", { timeout: 2000 });
  // Scroll the whole page: nothing logs an error, nothing scrolls sideways.
  for (let y = 0; y < 14000; y += 800) await page.evaluate((v) => window.scrollTo(0, v), y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  expect(errors).toEqual([]);
});

test("keyboard only: skip link, then the bar's links and the primary action, each with a visible focus", async ({
  page,
}) => {
  lightOnly();
  test.skip(test.info().project.name.endsWith("mobile"), "keyboards are a desktop path");
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  const names: string[] = [];
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Tab");
    names.push(await page.evaluate(() => (document.activeElement as HTMLElement).innerText.trim()));
  }
  expect(names).toEqual(["Tomorrow Lens", "How it works", "Try it", "Results", "GitHub", "Try a missed session", "Try a missed session"]); // prettier-ignore
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(page.locator("#missed-session [data-anim]").first()).not.toHaveAttribute("data-anim", "idle", { timeout: 8000 }); // prettier-ignore
});

test("Add to calendar downloads the verified plan as an .ics file", async ({ page }) => {
  lightOnly();
  await page.goto("/#sample-week");
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible({ timeout: 15_000 });
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Add to calendar (.ics)" }).click()]); // prettier-ignore
  expect(file.suggestedFilename()).toBe("lens-plan.ics");
  const text = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(text).toMatch(/^BEGIN:VCALENDAR\r\n/);
  expect(text).toContain("RRULE:FREQ=WEEKLY");
});
