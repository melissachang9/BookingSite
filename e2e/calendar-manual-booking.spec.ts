import { expect, test, type Page } from "@playwright/test";

import {
  e2eDashboardBaseURL,
  e2eDemoOwnerEmail,
  e2eDemoOwnerPassword,
  e2eTenantSlug,
  resetE2EData,
} from "./helpers/platform-api";

async function signInAsDemoOwner(page: Page) {
  await page.goto(`${e2eDashboardBaseURL}/login`);
  await expect(page.getByRole("heading", { name: "Sign in to Studio OS" })).toBeVisible();
  await page.getByLabel("Email").fill(e2eDemoOwnerEmail);
  await page.getByLabel("Password").fill(e2eDemoOwnerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.beforeEach(async ({ request }) => {
  if (process.env.E2E_SKIP_RESET !== "1") {
    await resetE2EData(request, e2eTenantSlug);
  }
});

test("staff navigates calendar and opens slot actions from schedule track", async ({ page }) => {
  await signInAsDemoOwner(page);

  await page
    .getByRole("navigation", { name: "Dashboard sections" })
    .getByRole("link", { name: "Calendar" })
    .click();

  // Calendar loads with week view showing the current week
  await expect(page.locator(".schedule-board")).toBeVisible({ timeout: 15000 });

  // Switch to day view
  await page.getByRole("button", { name: "Day" }).click();
  await expect(page.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");

  // Wait for schedule tracks to render
  await expect(page.locator(".schedule-day-track--interactive").first()).toBeVisible({ timeout: 10000 });

  // Click the first interactive schedule track to open slot actions
  await page.locator(".schedule-day-track--interactive").first().click();

  // Slot actions drawer opens
  await expect(page.getByRole("dialog", { name: "Calendar slot actions" })).toBeVisible();

  // Default mode is appointment — toggle button offers switching to time block
  await expect(page.getByRole("button", { name: "Create time block" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeVisible();
});