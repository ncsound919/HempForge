import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./tests/results",
  timeout: 30000,
  retries: 1,
  workers: 2,
  reporter: [
    ["list"],
    ["html", { outputFolder: "tests/playwright-report", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "api",
      testMatch: "**/api/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "unit",
      testMatch: "**/unit/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "e2e-chromium",
      testMatch: "**/e2e/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx tsx server.ts",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 30000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "test",
      USE_LOCAL_DB_FALLBACK: "true",
      COA_SIGNING_SECRET: "playwright-test-signing-secret-abc123",
    },
  },
});
