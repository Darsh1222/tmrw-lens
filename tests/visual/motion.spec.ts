import { expect, test, type Page } from "@playwright/test";

// Animations run only while a person can see them (src/app/_lens/useSeen.ts): each animated element starts once it's
// 60% in view (a tall one once it fills half the screen), pauses below 20%, and resumes from the same step. Checked at
// phone width (390x844) and desktop (1440x900), with layout shift staying at 0. Each element says its state in
// data-anim: idle, playing, paused, done.

/** Motion is the same in either theme: phone and desktop, light only. */
const lightOnly = () => test.skip(!test.info().project.name.startsWith("light"), "motion is the same in either theme");

async function watchShift(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
}
const shift = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);

// The observer reports on the next rendered frame; headless Chrome renders lazily, so each scroll settles briefly,
// as a person's scroll would end before they look.
const settle = (page: Page) => page.waitForTimeout(400);
test("the real schedule follows preview and approval with reduced motion enabled", async ({ page }) => {
  lightOnly();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const schedule = page.locator('section[aria-label="Your changing schedule"]');
  await expect(schedule).toHaveAttribute("data-phase", "before");
  await page.getByRole("button", { name: "Preview my plan" }).click();
  await expect(schedule).toHaveAttribute("data-phase", "preview");
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(schedule).toHaveAttribute("data-phase", "active");
});

test("the plan's cards don't arrive until the plan is in view", async ({ page }) => {
  lightOnly();
  await watchShift(page);
  await page.goto("/?tab=sources");
  await page.getByRole("button", { name: "Try the sample week" }).click();
  await page.getByRole("heading", { name: "What Lens found." }).waitFor();
  const plan = page.locator('section[aria-labelledby="plan-title"] [data-anim]');
  await page.waitForTimeout(2500); // the outlines draw meanwhile
  const below = await plan.evaluate((n) => n.getBoundingClientRect().top > window.innerHeight * 0.9);
  if (below) {
    expect(await plan.getAttribute("data-anim")).toBe("idle");
    await page.waitForTimeout(1500);
    expect(await plan.getAttribute("data-anim")).toBe("idle"); // it waited, unseen
  }
  const before = await shift(page);
  await plan.evaluate((n) => n.scrollIntoView({ block: "start" }));
  await settle(page);
  await expect(plan).toHaveAttribute("data-anim", /playing|done/);
  await expect(plan).toHaveAttribute("data-anim", "done", { timeout: 5000 });
  // The cards arrive by transform and opacity only: their arrival shifts nothing.
  expect((await shift(page)) - before).toBeLessThan(0.001);
});

test("the missed-session demo: pauses when scrolled away, resumes at the same step, then Play again", async ({
  page,
}) => {
  lightOnly();
  await watchShift(page);
  await page.goto("/demo");
  const panel = page.locator("#missed-session [data-anim]").first();
  await panel.evaluate((n) => n.scrollIntoView({ block: "start" }));
  await settle(page);
  await expect(panel).toHaveAttribute("data-anim", "idle"); // never on its own
  await panel.getByRole("button", { name: /^Play: miss/ }).click();
  await expect(panel).toHaveAttribute("data-anim", "playing");
  const said = panel.getByText(/^Tomorrow: Did .+ happen\?/);
  await expect(said).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  await expect(panel).toHaveAttribute("data-anim", "paused");
  const shown = await panel.locator("[data-step]").count();
  await page.waitForTimeout(3000);
  expect(await panel.getAttribute("data-anim")).toBe("paused");
  expect(await panel.locator("[data-step]").count()).toBe(shown); // nothing moved on, unseen
  await panel.evaluate((n) => n.scrollIntoView({ block: "start" }));
  await settle(page);
  await expect(panel).toHaveAttribute("data-anim", "playing");
  await expect(panel).toHaveAttribute("data-anim", "done", { timeout: 30000 });
  await expect(panel.getByRole("button", { name: "Play again" })).toBeVisible();
  expect(await shift(page)).toBeLessThan(0.001); // 0 to three decimals, as Lighthouse reports it
});
