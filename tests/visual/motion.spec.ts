import { expect, test, type Locator, type Page } from "@playwright/test";

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

/** How far the first running animation inside `el` has got, in ms. */
const progress = (el: Locator) =>
  el.evaluate((node) => {
    const a = node.getAnimations({ subtree: true }).find((x) => x.currentTime !== null);
    return a ? Number(a.currentTime) : -1;
  });

// The observer reports on the next rendered frame; headless Chrome renders lazily, so each scroll settles briefly,
// as a person's scroll would end before they look.
const settle = (page: Page) => page.waitForTimeout(400);
/** Scroll so the element's middle sits mid-screen. */
const centre = async (el: Locator) => (await el.evaluate((n) => n.scrollIntoView({ block: "center" })), settle(el.page())); // prettier-ignore
const away = async (page: Page) => (await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)), settle(page)); // prettier-ignore

test("the hero's preview: plays only when seen, pauses away, resumes where it was, and loops while seen", async ({
  page,
}) => {
  lightOnly();
  await watchShift(page);
  await page.goto("/");
  const glide = page.locator(".glide");
  // At load it plays only if it's already 60% in view.
  const ratio = await glide.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const bottom = window.innerHeight * 0.9;
    return Math.max(0, Math.min(r.bottom, bottom) - Math.max(r.top, 0)) / r.height;
  });
  await page.waitForTimeout(300);
  expect(await glide.getAttribute("data-anim")).toBe(ratio >= 0.6 ? "playing" : "idle");
  if (ratio < 0.6) expect(await progress(glide)).toBeLessThanOrEqual(0);

  await centre(glide);
  await expect(glide).toHaveAttribute("data-anim", "playing");
  await page.waitForTimeout(1200);
  await away(page);
  await expect(glide).toHaveAttribute("data-anim", "paused");
  const frozen = await progress(glide);
  await page.waitForTimeout(1000);
  expect(Math.abs((await progress(glide)) - frozen)).toBeLessThan(50); // stopped where it was
  await centre(glide);
  await expect(glide).toHaveAttribute("data-anim", "playing");
  await page.waitForTimeout(500);
  expect(await progress(glide)).toBeGreaterThan(frozen); // and goes on from there, not from the start
  await expect(glide).toHaveAttribute("data-anim", "done", { timeout: 9000 });
  await expect(glide).toHaveAttribute("data-anim", "playing", { timeout: 5000 }); // again, after a 3 s hold
  expect(await shift(page)).toBeLessThan(0.001); // 0 to three decimals, as Lighthouse reports it
});

test("the plan's cards don't arrive until the plan is in view", async ({ page }) => {
  lightOnly();
  await watchShift(page);
  await page.goto("/");
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
  await page.goto("/");
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
