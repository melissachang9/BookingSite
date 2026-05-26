import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  e2eApiBaseURL,
  e2eDashboardBaseURL,
  e2eDemoOwnerEmail,
  e2eDemoOwnerPassword,
  e2eTenantSlug,
  listServices,
  resetE2EData,
} from "./helpers/platform-api";

const apiURL = (path: string) => {
  const normalizedBaseURL = e2eApiBaseURL.endsWith("/") ? e2eApiBaseURL : `${e2eApiBaseURL}/`;
  return new URL(path.replace(/^\/+/, ""), normalizedBaseURL).toString();
};

test.describe.configure({ mode: "serial" });

function nextWeekday(targetWeekday: number): string {
  const today = new Date();
  const currentWeekday = (today.getUTCDay() + 6) % 7;
  let daysAhead = (targetWeekday - currentWeekday + 7) % 7;
  if (daysAhead === 0) {
    daysAhead = 1;
  }

  const nextDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysAhead));
  return nextDate.toISOString().slice(0, 10);
}

async function signInAsDemoOwner(page: Page) {
  await page.goto(`${e2eDashboardBaseURL}/login`);
  await expect(page.getByRole("heading", { name: "Sign in to Studio OS" })).toBeVisible();
  await page.getByLabel("Email").fill(e2eDemoOwnerEmail);
  await page.getByLabel("Password").fill(e2eDemoOwnerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function createAwaitingPaymentDraft(
  request: APIRequestContext,
  options: { slotIndex?: number } = {},
): Promise<{ bookingDraftId: string; customerName: string; customerEmail: string }> {
  const serviceResponse = await listServices(request, e2eTenantSlug);
  const service = serviceResponse.services.find((entry) => entry.name === "Signature Facial");

  expect(service).toBeTruthy();
  if (!service) {
    throw new Error("Signature Facial service was not found for the E2E tenant.");
  }

  const availabilityResponse = await request.get(apiURL(`tenants/${e2eTenantSlug}/availability`), {
    params: {
      serviceId: service.id,
      date: nextWeekday(3),
    },
  });
  await expect(availabilityResponse).toBeOK();
  const availabilityPayload = (await availabilityResponse.json()) as {
    slots: Array<{
      providerId: string;
      locationId?: string;
      startAt: string;
    }>;
  };
  const slotIndex = Math.min(options.slotIndex ?? 0, Math.max(availabilityPayload.slots.length - 1, 0));
  const firstSlot = availabilityPayload.slots[slotIndex] as {
    providerId: string;
    locationId?: string;
    startAt: string;
  };

  const createResponse = await request.post(apiURL(`tenants/${e2eTenantSlug}/booking-drafts`), {
    data: {
      tenantSlug: e2eTenantSlug,
      serviceId: service.id,
      providerId: firstSlot.providerId,
      locationId: firstSlot.locationId,
      startsAt: firstSlot.startAt,
    },
  });
  await expect(createResponse).toBeOK();
  const bookingDraftId = (await createResponse.json()).id as string;

  const customerName = `Deposit Follow Up ${Date.now()}`;
  const customerEmail = `follow-up-${Date.now()}@example.com`;
  const updateResponse = await request.patch(apiURL(`tenants/${e2eTenantSlug}/booking-drafts/${bookingDraftId}`), {
    data: {
      customer: {
        name: customerName,
        email: customerEmail,
        phone: "555-0800",
      },
      intakeCompletionTiming: "before_visit",
    },
  });
  await expect(updateResponse).toBeOK();

  const checkoutResponse = await request.post(apiURL(`tenants/${e2eTenantSlug}/payments/checkout-sessions`), {
    data: {
      tenantSlug: e2eTenantSlug,
      bookingDraftId,
      kind: "deposit",
      successUrl: `http://127.0.0.1:3001/${e2eTenantSlug}/book/${bookingDraftId}/success`,
      cancelUrl: `http://127.0.0.1:3001/${e2eTenantSlug}/book/${bookingDraftId}`,
    },
  });
  await expect(checkoutResponse).toBeOK();

  return { bookingDraftId, customerName, customerEmail };
}

test.beforeEach(async ({ request }) => {
  if (process.env.E2E_SKIP_RESET !== "1") {
    await resetE2EData(request, e2eTenantSlug);
  }
});

test("staff can open unpaid deposit follow-up work from the dashboard", async ({ page, request }) => {
  const awaitingPaymentDraft = await createAwaitingPaymentDraft(request);

  await signInAsDemoOwner(page);

  await page
    .getByRole("navigation", { name: "Primary dashboard sections" })
    .getByRole("link", { name: /Payments/ })
    .click();

  await expect(page.getByRole("heading", { name: "Outstanding payment links" })).toBeVisible();

  const queueCard = page.locator(".service-catalog-card").filter({
    has: page.getByRole("heading", { name: awaitingPaymentDraft.customerName }),
  });
  await expect(queueCard).toBeVisible({ timeout: 15_000 });
  await expect(queueCard.getByText("Link ready")).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await queueCard.getByRole("button", { name: "Open checkout link" }).click();
  const popup = await popupPromise;

  await popup.waitForLoadState("domcontentloaded");
  await expect(popup).toHaveURL(new RegExp(`/${e2eTenantSlug}/book/${awaitingPaymentDraft.bookingDraftId}/payment\\?sessionId=`));
});

test("staff can copy an unpaid deposit link from the dashboard", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const awaitingPaymentDraft = await createAwaitingPaymentDraft(request, { slotIndex: 1 });

  await signInAsDemoOwner(page);

  await page
    .getByRole("navigation", { name: "Primary dashboard sections" })
    .getByRole("link", { name: /Payments/ })
    .click();

  await expect(page.getByRole("heading", { name: "Outstanding payment links" })).toBeVisible();

  const queueCard = page.locator(".service-catalog-card").filter({
    has: page.getByRole("heading", { name: awaitingPaymentDraft.customerName }),
  });
  await expect(queueCard).toBeVisible({ timeout: 15_000 });

  await queueCard.getByRole("button", { name: "Copy checkout link" }).click();
  await expect(page.getByText("Copied checkout link to the clipboard.")).toBeVisible();

  const copiedValue = await page.evaluate(async () => navigator.clipboard.readText());
  expect(copiedValue).toMatch(new RegExp(`/${e2eTenantSlug}/book/${awaitingPaymentDraft.bookingDraftId}/payment\\?sessionId=`));
});

test("staff can send a reminder email from the dashboard queue", async ({ page, request }) => {
  const awaitingPaymentDraft = await createAwaitingPaymentDraft(request, { slotIndex: 2 });

  await page.route(`**/tenants/${e2eTenantSlug}/payments/follow-up/${awaitingPaymentDraft.bookingDraftId}/send-reminder`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bookingDraftId: awaitingPaymentDraft.bookingDraftId,
        paymentId: "payment_123",
        checkoutSessionId: "session_123",
        checkoutUrl: `http://127.0.0.1:3001/${e2eTenantSlug}/book/${awaitingPaymentDraft.bookingDraftId}/payment?sessionId=session_123`,
        recipientEmail: awaitingPaymentDraft.customerEmail,
        provider: "resend",
        providerMessageId: "email_123",
        sentAt: new Date().toISOString(),
      }),
    });
  });

  await signInAsDemoOwner(page);

  await page
    .getByRole("navigation", { name: "Primary dashboard sections" })
    .getByRole("link", { name: /Payments/ })
    .click();

  await expect(page.getByRole("heading", { name: "Outstanding payment links" })).toBeVisible();

  const queueCard = page.locator(".service-catalog-card").filter({
    has: page.getByRole("heading", { name: awaitingPaymentDraft.customerName }),
  });
  await expect(queueCard).toBeVisible({ timeout: 15_000 });

  await queueCard.getByRole("button", { name: "Send reminder email" }).click();
  await expect(page.getByText(`Reminder email sent to ${awaitingPaymentDraft.customerEmail}.`)).toBeVisible();
});

test("staff can draft a reminder email for an unpaid deposit from the dashboard", async ({ page, request }) => {
  const awaitingPaymentDraft = await createAwaitingPaymentDraft(request, { slotIndex: 3 });

  await signInAsDemoOwner(page);

  await page
    .getByRole("navigation", { name: "Primary dashboard sections" })
    .getByRole("link", { name: /Payments/ })
    .click();

  await expect(page.getByRole("heading", { name: "Outstanding payment links" })).toBeVisible();

  const queueCard = page.locator(".service-catalog-card").filter({
    has: page.getByRole("heading", { name: awaitingPaymentDraft.customerName }),
  });
  await expect(queueCard).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => {
    const openedUrls: string[] = [];
    (window as Window & { __openedUrls?: string[] }).__openedUrls = openedUrls;
    window.open = ((url?: string | URL) => {
      openedUrls.push(String(url ?? ""));
      return null;
    }) as typeof window.open;
  });

  await queueCard.getByRole("button", { name: "Draft reminder email" }).click();
  await expect(page.getByText("Opened a prefilled reminder email.")).toBeVisible();

  const openedUrl = await page.evaluate(() => (window as Window & { __openedUrls?: string[] }).__openedUrls?.at(-1) ?? null);
  expect(openedUrl).not.toBeNull();
  expect(openedUrl).toContain(`mailto:${encodeURIComponent(awaitingPaymentDraft.customerEmail)}`);
  expect(decodeURIComponent(openedUrl ?? "")).toContain(`/${e2eTenantSlug}/book/${awaitingPaymentDraft.bookingDraftId}/payment?sessionId=`);
});