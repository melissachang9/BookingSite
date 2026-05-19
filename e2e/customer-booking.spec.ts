import { expect, test } from "@playwright/test";

import { e2eTenantSlug, expectSlotConflict, getBookingDraft, getTenant, listServices } from "./helpers/platform-api";

test("customer can select a service and hold an appointment slot", async ({ page, request }) => {
  const tenant = await getTenant(request, e2eTenantSlug);
  const serviceResponse = await listServices(request, tenant.slug);
  const service = serviceResponse.services.find((entry) => entry.isActive);

  expect(service).toBeDefined();
  if (!service) {
    throw new Error("Seeded tenant has no active services for E2E booking.");
  }

  await page.goto(`/${tenant.slug}`);

  await expect(page.getByRole("heading", { name: `Reserve your appointment at ${tenant.name}.` })).toBeVisible();
  await expect(page.getByText(`${tenant.settings.maxAdvanceBookingDays} days ahead`)).toBeVisible();
  await expect(page.getByText(`${tenant.settings.minLeadTimeMinutes} minutes`)).toBeVisible();

  const serviceCard = page.locator(".service-card").filter({
    has: page.getByRole("heading", { name: service.name }),
  });
  await expect(serviceCard).toBeVisible();

  await serviceCard.getByRole("link", { name: "View openings" }).click();

  await expect(page.getByRole("heading", { name: service.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Select your appointment time" })).toBeVisible();

  const firstSlotButton = page.locator(".slot-button").first();
  await expect(firstSlotButton).toBeVisible();
  const selectedProviderName = (await firstSlotButton.locator("strong").innerText()).trim();

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