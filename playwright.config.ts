import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.playwright.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
    browserName: process.env.E2E_BROWSER === "webkit" ? "webkit" : "chromium",
    viewport: { width: 375, height: 812 },
    trace: "retain-on-failure",
  },
});
