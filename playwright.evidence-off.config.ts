import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "basic-medical-evidence-pdf-off.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3011",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "npm run dev -- --port 3011",
    env: {
      ...process.env,
      BASIC_MEDICAL_CONFIRMATION_EVIDENCE_ENABLED: "false",
      NEXT_PUBLIC_IMPORTS_ENABLED: "true",
      CRON_SECRET: process.env.CRON_SECRET ?? "local-e2e-cron-secret",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3011",
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
