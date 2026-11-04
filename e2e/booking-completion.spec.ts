import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  e2eApiBaseURL,
  e2eDashboardBaseURL,
  e2eDemoOwnerEmail,
  e2eDemoOwnerPassword,
  e2eTenantSlug,
  getBooking,
  listServices,
  resetE2EData,
} from "./helpers/platform-api";

// Staff complete a confirmed visit from the calendar and collect the remaining balance in cash.
// The deposit is paid through the simulated checkout, which the API only allows when no live Stripe key is
// configured, so run this against a stack started without STRIPE_SECRET_KEY (CI does).
//
// Resets the demo tenant first (set E2E_SKIP_RESET=1 to skip) — do not run against data you want to keep.

test.describe.configure({ mode: "serial" });

const apiURL = (path: string) => {
  const base = e2eApiBaseURL.endsWith("/") ? e2eApiBaseURL : `${e2eApiBaseURL}/`;
  return new URL(path.replace(/^\/+/, ""), base).toString();
};

function nextWeekday(targetWeekday: number): string {
  const today = new Date();
  const currentWeekday = (today.getUTCDay() + 6) % 7;
  let daysAhead = (targetWeekday - currentWeekday + 7) % 7;
  if (daysAhead === 0) daysAhead = 1;
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysAhead)).toISOString().slice(0, 10);
}

type FormRequirement = {
  id: string;
  scope: string;
  schema?: { fields?: Array<{ id: string; type: string; options?: Array<{ value: string }> }> } | null;
};

function sampleAnswer(field: { type: string; options?: Array<{ value: string }> }): unknown {
  const first = field.options?.[0]?.value;
  const answers: Record<string, unknown> = {
    short_text: "Test answer",
    long_text: "Test answer",
    yes_no: true,
    checkbox: true,
    number: 1,
    date: "2000-01-01",
    select: first,
    multi_select: first ? [first] : [],
  };
  return answers[field.type];
}

async function createConfirmedBooking(request: APIRequestContext): Promise<{ bookingId: string; customerName: string }> {
  const service = (await listServices(request, e2eTenantSlug)).services.find((entry) => entry.name === "Signature Facial");
  expect(service, "Signature Facial service").toBeTruthy();

  const availability = await request.get(apiURL(`tenants/${e2eTenantSlug}/availability`), {
    params: { serviceId: service!.id, date: nextWeekday(3) },
  });
  await expect(availability).toBeOK();
  const slot = ((await availability.json()) as { slots: Array<{ providerId: string; locationId?: string; startAt: string }> }).slots[0];

  const draftResponse = await request.post(apiURL(`tenants/${e2eTenantSlug}/booking-drafts`), {
    data: { tenantSlug: e2eTenantSlug, serviceId: service!.id, providerId: slot.providerId, locationId: slot.locationId, startsAt: slot.startAt },
  });
  await expect(draftResponse).toBeOK();
  const draft = (await draftResponse.json()) as { id: string; formRequirements: FormRequirement[] };

  const customerName = `Balance Guest ${Date.now()}`;
  await expect(
    await request.patch(apiURL(`tenants/${e2eTenantSlug}/booking-drafts/${draft.id}`), {
      data: {
        customer: { name: customerName, email: `balance-${Date.now()}@example.com`, phone: "555-0801" },
        intakeCompletionTiming: "before_visit",
      },
    }),
  ).toBeOK();

  for (const requirement of draft.formRequirements.filter((entry) => entry.scope === "customer")) {
    const answers: Record<string, unknown> = {};
    for (const field of requirement.schema?.fields ?? []) {
      const value = sampleAnswer(field);
      if (value !== undefined) answers[field.id] = value;
    }
    await expect(
      await request.post(apiURL(`tenants/${e2eTenantSlug}/booking-drafts/${draft.id}/form-requirements/${requirement.id}/submit`), { data: { answers } }),
    ).toBeOK();
  }

  const checkout = await request.post(apiURL(`tenants/${e2eTenantSlug}/payments/checkout-sessions`), {
    data: {
      tenantSlug: e2eTenantSlug,
      bookingDraftId: draft.id,
      kind: "deposit",
      successUrl: `http://127.0.0.1:3001/${e2eTenantSlug}/book/${draft.id}/success`,
      cancelUrl: `http://127.0.0.1:3001/${e2eTenantSlug}/book/${draft.id}`,
    },
  });
  await expect(checkout).toBeOK();
  const { sessionId } = (await checkout.json()) as { sessionId: string };

  const completed = await request.post(apiURL(`tenants/${e2eTenantSlug}/payments/checkout-sessions/${sessionId}/complete`));
  await expect(completed, "simulated deposit (start the API without STRIPE_SECRET_KEY)").toBeOK();
  const booking = (await completed.json()) as { id: string; status: string };
  expect(booking.status).toBe("confirmed");
  return { bookingId: booking.id, customerName };
}

async function openAppointment(page: Page, customerName: string) {
  await page.goto(`${e2eDashboardBaseURL}/login`);
  await page.getByLabel("Email").fill(e2eDemoOwnerEmail);
  await page.getByLabel("Password").fill(e2eDemoOwnerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  await page.goto(`${e2eDashboardBaseURL}/calendar`);
  await expect(page.getByRole("button", { name: "Staff filter" })).toBeVisible({ timeout: 20_000 });

  // The booking is next Thursday at the latest, so it is at most two weeks ahead.
  for (let weeks = 0; weeks < 3 && (await page.getByText(customerName).count()) === 0; weeks += 1) {
    await page.getByRole("button", { name: "Next week" }).click();
    await page.waitForTimeout(500);
  }
  await page.getByText(customerName).first().click();
  return page.getByRole("dialog", { name: "Appointment details" });
}

test.beforeEach(async ({ request }) => {
  if (process.env.E2E_SKIP_RESET !== "1") {
    await resetE2EData(request, e2eTenantSlug);
  }
});

test("staff complete a visit and collect the remaining balance in cash", async ({ page, request }) => {
  const { bookingId, customerName } = await createConfirmedBooking(request);
  const before = await getBooking(request, e2eTenantSlug, bookingId);
  expect(before.status).toBe("confirmed");

  const details = await openAppointment(page, customerName);
  await expect(details.getByText("CONFIRMED", { exact: false }).first()).toBeVisible();
  await details.getByRole("button", { name: "Complete & check out" }).click();

  const checkout = page.getByRole("dialog", { name: "Checkout" });
  await expect(checkout.getByText("Balance due")).toBeVisible();
  await expect(checkout.getByText("Deposit")).toBeVisible();

  await checkout.getByRole("button", { name: /^Cash/ }).click();
  const record = checkout.getByRole("button", { name: /^Record \$/i });
  await expect(record).toBeVisible();
  await record.click();

  // Recording the exact balance settles the visit and completes the sale in one step.
  await expect(checkout.getByRole("heading", { name: "Sale Complete" })).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(async () => (await getBooking(request, e2eTenantSlug, bookingId)).status, { timeout: 15_000 })
    .toBe("completed");
  const after = (await getBooking(request, e2eTenantSlug, bookingId)) as unknown as Record<string, unknown>;
  expect(after.paymentResolution).toBe("collected");
});
