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

  await expect(page.locator(".schedule-board")).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");

  await expect(page.locator(".schedule-day-track--interactive").first()).toBeVisible({ timeout: 10000 });

  await page.locator(".schedule-day-track--interactive").first().click();

  await expect(page.getByRole("dialog", { name: "Calendar slot actions" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Create time block" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeVisible();
});

test("staff creates a booking draft from calendar slot", async ({ page }) => {
  await signInAsDemoOwner(page);

  await page
    .getByRole("navigation", { name: "Dashboard sections" })
    .getByRole("link", { name: "Calendar" })
    .click();

  await expect(page.locator(".schedule-board")).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Day", exact: true }).click();

  await expect(page.locator(".schedule-day-track--interactive").first()).toBeVisible({ timeout: 10000 });
  await page.locator(".schedule-day-track--interactive").first().click();

  await expect(page.getByRole("dialog", { name: "Calendar slot actions" })).toBeVisible();

  // Select an appointment type
  const serviceSelect = page.getByLabel("Appointment type");
  await expect(serviceSelect).toBeVisible({ timeout: 5000 });
  await serviceSelect.selectOption({ index: 0 });

  // Fill in customer details
  await page.getByLabel("Client name").fill("Test Customer");
  await page.getByLabel("Phone number").fill("+1 555-555-1234");
  await page.getByLabel("Email").fill("test@example.com");

  // Book appointment
  await page.getByRole("button", { name: "Book appointment" }).click();

  // Should show success message
  await expect(page.getByText("Booking draft created")).toBeVisible({ timeout: 10000 });

  // Should show link to open draft in storefront
  await expect(page.getByRole("link", { name: "Open draft in storefront" })).toBeVisible({ timeout: 5000 });
});
