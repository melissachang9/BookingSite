import { expect, test } from "@playwright/test";

import { e2eTenantSlug, expectSlotConflict, getBookingDraft, getTenant, listServices, resetE2EData } from "./helpers/platform-api";

test.beforeEach(async ({ request }) => {
  if (process.env.E2E_SKIP_RESET !== "1") {
    await resetE2EData(request, e2eTenantSlug);
  }
});

test("customer can select a service and hold an appointment slot", async ({ page, request }) => {
  const tenant = await getTenant(request, e2eTenantSlug);
  const serviceResponse = await listServices(request, tenant.slug);
  const service = serviceResponse.services.find((entry) => entry.isActive);

  expect(service).toBeDefined();
  if (!service) {
    throw new Error("Seeded tenant has no active services for E2E booking.");
  }

  await page.goto(`/${tenant.slug}`);

  await expect(page.getByRole("heading", { name: "How can we help?" })).toBeVisible();
  await page.getByRole("link", { name: /I'm new to Brow Beauty Lab/ }).click();

  const locationStepHeading = page.getByRole("heading", { name: "Choose a location" });
  const serviceStepHeading = page.getByRole("heading", { name: "Select a service" });
  const nextStep = await Promise.race([
    serviceStepHeading.waitFor({ state: "visible", timeout: 15_000 }).then(() => "services"),
    locationStepHeading.waitFor({ state: "visible", timeout: 15_000 }).then(() => "locations"),
  ]);

  if (nextStep === "locations") {
    await Promise.all([
      page.waitForURL(new RegExp(`/${tenant.slug}/services(\\?|$)`)),
      page.getByRole("link", { name: /Downtown Studio/ }).click(),
    ]);
  }

  await expect(serviceStepHeading).toBeVisible({ timeout: 15_000 });

  const serviceCard = page.locator(".service-row-card").filter({
    has: page.getByRole("heading", { name: service.name }),
  });
  await expect(serviceCard).toBeVisible();

  await Promise.all([
    page.waitForURL(new RegExp(`/${tenant.slug}/services/[^/?]+(\\?|$)`)),
    serviceCard.getByRole("link", { name: "Choose service" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: service.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose your provider preference" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "No preference" })).toBeVisible();

  await Promise.all([
    page.waitForURL(new RegExp(`/${tenant.slug}/services/[^/]+/availability`)),
    page.getByRole("link", { name: "Show next availability" }).first().click(),
  ]);

  await expect(page.getByRole("heading", { name: "Your Appointment" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Select a date" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Select a time for/ })).toBeVisible();

  const firstSlotButton = page.locator(".slot-button").first();
  await expect(firstSlotButton).toBeVisible();
  const selectedProviderName = await firstSlotButton.getAttribute("data-provider-name");
  expect(selectedProviderName).toBeTruthy();

  await Promise.all([
    page.waitForURL(new RegExp(`/${tenant.slug}/book/[^/]+$`)),
    firstSlotButton.click(),
  ]);

  const bookingDraftId = new URL(page.url()).pathname.split("/").pop();
  expect(bookingDraftId).toBeTruthy();

  const draft = await getBookingDraft(request, tenant.slug, bookingDraftId ?? "");
  expect(draft.status).toBe("slot_held");
  expect(draft.bookingMethod).toBe("public_online");
  expect(draft.serviceId).toBe(service.id);
  expect(draft.service.name).toBe(service.name);
  expect(draft.provider.name).toBe(selectedProviderName);

  await expect(page.getByRole("heading", { name: service.name })).toBeVisible();
  await expect(page.getByText(draft.provider.name)).toBeVisible();
  await expect(page.getByText("Hold expires")).toBeVisible();
  await expect(page.locator(".panel-badge").filter({ hasText: "slot held" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeDisabled();

  await expectSlotConflict(request, tenant.slug, draft);
});