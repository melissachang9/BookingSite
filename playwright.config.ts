import { defineConfig, devices } from "@playwright/test";

const storefrontBaseURL = process.env.E2E_STOREFRONT_BASE_URL ?? "http://127.0.0.1:3001";
const shouldStartWebServer = process.env.E2E_SKIP_WEB_SERVER !== "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: storefrontBaseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: shouldStartWebServer
    ? {
        command: process.env.E2E_WEB_SERVER_COMMAND ?? "docker compose up --build",
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        url: storefrontBaseURL,
      }
    : undefined,
});