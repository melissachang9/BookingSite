import { expect, test } from "@playwright/test";

import {
  e2eDashboardBaseURL,
  e2eDemoOwnerEmail,
  e2eDemoOwnerPassword,
  e2eStorefrontBaseURL,
  e2eTenantSlug,
  listServices,
} from "./helpers/platform-api";

test("manager creates and publishes a tenant-scoped service", async ({ page, request }) => {
  const serviceName = `Playwright Recovery Facial ${Date.now()}`;

  await page.goto(`${e2eDashboardBaseURL}/login`);
  await expect(page.getByRole("heading", { name: "Sign in to Studio OS" })).toBeVisible();

  await page.getByLabel("Email").fill(e2eDemoOwnerEmail);
  await page.getByLabel("Password").fill(e2eDemoOwnerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page
    .getByRole("navigation", { name: "Primary dashboard sections" })
    .getByRole("link", { name: "Services Catalog" })
    .click();

  await expect(page.getByRole("heading", { name: "Create tenant-scoped service" })).toBeVisible();
  await page.getByLabel("Service name").fill(serviceName);
  await page.getByLabel("Duration (minutes)").fill("75");
  await page.getByLabel("Price").fill("185.00");
  await page.getByLabel("Deposit due today").fill("50.00");
  await page.getByLabel("Description").fill("Playwright-created service for dashboard coverage.");
  await page.getByRole("button", { name: "Create service" }).click();

  await expect(page.getByText("Service created and added to the demo catalog.")).toBeVisible();
  await expect(page.getByRole("heading", { name: serviceName })).toBeVisible();

  const serviceResponse = await listServices(request, e2eTenantSlug);
  const createdService = serviceResponse.services.find((service) => service.name === serviceName);
  expect(createdService).toBeTruthy();
  expect(createdService?.priceCents).toBe(18_500);
  expect(createdService?.depositCents).toBe(5_000);

  await page.goto(`${e2eStorefrontBaseURL}/${e2eTenantSlug}/services?locationId=${createdService?.locationIds[0]}`);
  await expect(page.getByRole("heading", { name: "Select a service" })).toBeVisible();
  await expect(page.getByText(serviceName)).toBeVisible();
});