import { expect, test } from "@playwright/test";

import { e2eDashboardBaseURL, e2eStorefrontBaseURL, getTenant } from "./helpers/platform-api";

test("owner sets up a new business and publishes its storefront", async ({ page, request }) => {
  const suffix = Date.now();
  const tenantName = `Playwright Skin Studio ${suffix}`;
  const tenantSlug = `playwright-skin-${suffix}`;
  const ownerEmail = `owner-${suffix}@playwright.test`;

  await page.goto(`${e2eDashboardBaseURL}/login`);
  await expect(page.getByRole("heading", { name: "Sign in to Studio OS" })).toBeVisible();

  await page.getByRole("link", { name: "Set up a new business" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await expect(page.getByRole("heading", { name: "Set up a new business" })).toBeVisible();
  await page.getByLabel("Business name").fill(tenantName);
  await page.getByLabel("Business slug").fill(tenantSlug);
  await page.getByLabel("Timezone").fill("America/New_York");
  await page.getByLabel("Launch location").fill("Flagship Studio");
  await page.getByLabel("Owner name").fill("Morgan Hale");
  await page.getByLabel("Owner email").fill(ownerEmail);
  await page.getByLabel("Temporary password").fill("StudioSetup123");
  await page.getByLabel("Website").fill(`https://${tenantSlug}.example.com`);
  await page.getByRole("button", { name: "Create business" }).click();

  await expect(page.getByText("Business created and storefront published.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Storefront published" })).toBeVisible();
  await expect(page.getByText(`/${tenantSlug}`)).toBeVisible();
  await page.getByRole("button", { name: "Continue as owner" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByLabel("Signed-in operator")).toContainText("Morgan Hale");

  await page
    .getByRole("navigation", { name: "Primary dashboard sections" })
    .getByRole("link", { name: "Services Catalog" })
    .click();
  await expect(page.getByText("0 services")).toBeVisible();

  const createdTenant = await getTenant(request, tenantSlug);
  expect(createdTenant.name).toBe(tenantName);
  expect(createdTenant.defaultLocationId).toBeTruthy();

  await page.goto(`${e2eStorefrontBaseURL}/${tenantSlug}`);
  await expect(page).toHaveURL(new RegExp(`${tenantSlug}/services`));
  await expect(page.getByRole("heading", { name: "Select a service" })).toBeVisible();
  await expect(page.getByText("No services are available for this location.")).toBeVisible();
  await expect(page.getByRole("link", { name: tenantName })).toBeVisible();
});