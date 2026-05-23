import { expect, test, type Page } from "@playwright/test";

import {
  e2eDashboardBaseURL,
  e2eDemoOwnerEmail,
  e2eDemoOwnerPassword,
  e2eTenantSlug,
  resetE2EData,
} from "./helpers/platform-api";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

test("staff selects a real opening from the calendar before manual booking", async ({ page }) => {
  await signInAsDemoOwner(page);

  await page
    .getByRole("navigation", { name: "Primary dashboard sections" })
    .getByRole("link", { name: "Calendar" })
    .click();

  await expect(page.getByRole("heading", { name: "Choose a real opening before creating a booking." })).toBeVisible();

  const selectedOpeningInput = page.getByLabel("Selected opening");
  const providerInput = page.getByLabel("Provider");
  const customerInput = page.getByLabel("Customer");

  await expect(selectedOpeningInput).toHaveValue("Choose a slot");
  await expect(providerInput).toHaveValue("Choose a slot");
  await expect(customerInput).toHaveValue("Choose a slot first");

  const firstSlot = page.locator(".calendar-slot-card").first();
  await expect(firstSlot).toBeVisible();

  const slotTime = (await firstSlot.locator("strong").textContent())?.trim();
  const providerName = (await firstSlot.locator("span").textContent())?.trim();

  expect(slotTime).toBeTruthy();
  expect(providerName).toBeTruthy();

  await firstSlot.click();

  await expect(firstSlot).toHaveAttribute("aria-pressed", "true");
  await expect(customerInput).toHaveValue("Search existing customer");
  await expect(providerInput).toHaveValue(providerName ?? "");
  await expect(selectedOpeningInput).toHaveValue(new RegExp(escapeRegExp(slotTime ?? "")));
  await expect(page.getByText(new RegExp(`Selected .* with ${escapeRegExp(providerName ?? "")}`))).toBeVisible();
  await expect(page.getByRole("button", { name: "Create from selected slot" })).toBeDisabled();
});