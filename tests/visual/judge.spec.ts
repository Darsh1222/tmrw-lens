import { expect, test } from "@playwright/test";

// The judge's path: the two buttons at the top each show the product in about 10 seconds, free. Neither may call a
// model: the sample week is recorded readings, and a missed session with its own reply is its recorded run.

const lightOnly = () =>
  test.skip(!test.info().project.name.startsWith("light"), "the path is the same in either theme");

test("Try the sample week: opens the recorded week and its plan, with no model calls", async ({ page }) => {
  lightOnly();
  const calls: string[] = [];
  page.on("request", (r) => /\/api\/(read|rebuild|extract)/.test(r.url()) && calls.push(r.url()));
  await page.goto("/");
  await page.getByRole("link", { name: "Try the sample week" }).first().click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible({ timeout: 15_000 });
  expect(calls).toEqual([]);
});

test("Try a missed session: plays the recorded rebuild to its message, with no model calls", async ({ page }) => {
  lightOnly();
  const calls: string[] = [];
  page.on("request", (r) => /\/api\/(read|rebuild|extract)/.test(r.url()) && calls.push(r.url()));
  await page.goto("/");
  await page.getByRole("link", { name: "Try a missed session" }).first().click();
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
