import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for end-to-end smoke tests on the Next.js dev server.
 * Chromium-only for now to keep install + run footprint small (Phase 0 TODO
 * lists Playwright as opportunistic — first slot is the awards-ceremony
 * smoke; future cross-window admin-reveal coverage can add webkit/firefox
 * if needed).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3457",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Custom port (3457) so Playwright never collides with the cowork
    // dev servers that typically hold :3000 / :3001 in this repo.
    command: "npm run dev -- --port 3457",
    url: "http://localhost:3457",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
