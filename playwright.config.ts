import { defineConfig } from "@playwright/test";

// Visual smoke tests: every screen, light and dark, desktop and phone, against
// the production build. They check what a screenshot can't (no console errors,
// no sideways scroll, no layout shift) and save a screenshot of each screen to
// test-results/ for a person to look at. Model calls are mocked or replayed, so
// a run costs nothing. `pnpm build && pnpm test:visual`.

const PORT = 3312;

export default defineConfig({
  testDir: "tests/visual",
  outputDir: "test-results/visual",
  fullyParallel: true,
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    // Use an already-installed Chromium when given one (PW_CHROMIUM); otherwise `pnpm exec playwright install chromium`.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: `pnpm start --port ${PORT}`,
    port: PORT,
    reuseExistingServer: true,
    // No model key: live runs fall back to recordings, so the tests are free and stable.
    env: { META_API_KEY: "", LENS_REBUILD_SECRET: "" },
  },
  projects: [
    { name: "light-desktop", use: { colorScheme: "light", viewport: { width: 1440, height: 900 } } },
    { name: "dark-desktop", use: { colorScheme: "dark", viewport: { width: 1440, height: 900 } } },
    { name: "light-mobile", use: { colorScheme: "light", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }, // prettier-ignore
    { name: "dark-mobile", use: { colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }, // prettier-ignore
  ],
});
