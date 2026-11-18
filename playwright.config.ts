import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        env: {
          ...process.env,
          BASIC_MEDICAL_CONFIRMATION_EVIDENCE_ENABLED:
            process.env.BASIC_MEDICAL_CONFIRMATION_EVIDENCE_ENABLED ?? "true",
          NEXT_PUBLIC_IMPORTS_ENABLED:
            process.env.NEXT_PUBLIC_IMPORTS_ENABLED ?? "true",
          CRON_SECRET: process.env.CRON_SECRET ?? "local-e2e-cron-secret",
        },
        reuseExistingServer: true,
        timeout: 120_000,
        url: "http://localhost:3000",
      },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
