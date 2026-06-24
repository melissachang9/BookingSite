import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import type { BookingDraftSummary, ServiceSummary, TenantSummary } from "@booking/shared-types";

import {
  e2eApiBaseURL,
  e2eDemoOwnerEmail,
  e2eDemoOwnerPassword,
  e2eResetToken,
  e2eTenantSlug,
  expectSlotConflict,
  getBooking,
  getBookingDraft,
  getTenant,
  listServices,
  resetE2EData,
} from "./helpers/platform-api";

type StartedBooking = {
  tenant: TenantSummary;
  service: ServiceSummary;
  bookingDraftId: string;
  draft: BookingDraftSummary;
};

const apiURL = (path: string) => {
  const normalizedBaseURL = e2eApiBaseURL.endsWith("/") ? e2eApiBaseURL : `${e2eApiBaseURL}/`;
  return new URL(path.replace(/^\/+/, ""), normalizedBaseURL).toString();
};

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

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }) => {
  if (process.env.E2E_SKIP_RESET !== "1") {
    await resetE2EData(request, e2eTenantSlug);
  }
});

async function goToServiceCatalog(page: Page, tenantSlug: string) {
  await page.goto(`/${tenantSlug}`);

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
      page.waitForURL(new RegExp(`/${tenantSlug}/services(\\?|$)`)),
      page.getByRole("link", { name: /Downtown Studio/ }).click(),
    ]);
  }

  await expect(serviceStepHeading).toBeVisible({ timeout: 15_000 });
}

async function startBookingForService(
  page: Page,
  request: APIRequestContext,
  serviceName: string,
  options: { targetDate?: string } = {},
): Promise<StartedBooking> {
  const tenant = await getTenant(request, e2eTenantSlug);
  const serviceResponse = await listServices(request, tenant.slug);
  const service = serviceResponse.services.find((entry) => entry.name === serviceName && entry.isActive);

  expect(service).toBeDefined();
  if (!service) {
    throw new Error(`Seeded tenant is missing active service ${serviceName}.`);
  }

  await goToServiceCatalog(page, tenant.slug);

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

  await Promise.all([
    page.waitForURL(new RegExp(`/${tenant.slug}/services/[^/]+/availability`)),
    page.getByRole("link", { name: "Choose anyone" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Your Appointment" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Select a date" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Select a time for/ })).toBeVisible();

  if (options.targetDate) {
    const availabilityResponse = await request.get(apiURL(`tenants/${tenant.slug}/availability`), {
      params: {
        serviceId: service.id,
        date: options.targetDate,
      },
    });
    await expect(availabilityResponse).toBeOK();

    const availabilityPayload = (await availabilityResponse.json()) as {
      slots: Array<{ startAt: string }>;
    };
    expect(availabilityPayload.slots.length).toBeGreaterThan(0);

    const targetAvailabilityUrl = new URL(page.url());
    targetAvailabilityUrl.searchParams.set("date", options.targetDate);
    targetAvailabilityUrl.searchParams.set("month", options.targetDate.slice(0, 7));

    await page.goto(targetAvailabilityUrl.toString());
    await expect(page.getByRole("heading", { name: /Select a time for/ })).toBeVisible({ timeout: 15_000 });
  }

  const firstSlotButton = page.locator(".slot-button").first();
  await expect(firstSlotButton).toBeVisible();

  await Promise.all([
    page.waitForURL(new RegExp(`/${tenant.slug}/book/[^/]+$`)),
    firstSlotButton.click(),
  ]);

  await expect(page.getByRole("heading", { name: /add your contact details|your contact details/i })).toBeVisible();

  const bookingDraftId = new URL(page.url()).pathname.split("/").pop();
  expect(bookingDraftId).toBeTruthy();
  if (!bookingDraftId) {
    throw new Error("Booking draft id was not present in the booking review URL.");
  }

  const draft = await getBookingDraft(request, tenant.slug, bookingDraftId);

  return {
    tenant,
    service,
    bookingDraftId,
    draft,
  };
}

async function saveContactDetails(
  page: Page,
  details: {
    name: string;
    email: string;
    phone: string;
  },
) {
  const contactForm = page.locator(".contact-details-form");

  await expect(contactForm).toBeVisible();
  await contactForm.getByLabel("Full name").fill(details.name);
  await contactForm.getByRole("textbox", { name: "Email" }).fill(details.email);
  await contactForm.getByLabel("Phone number").fill(details.phone);
  await contactForm.getByRole("radio", { name: /Complete later/ }).check();
  await contactForm.getByRole("button", { name: "Save contact details" }).click();

  await expect(page.getByText(details.name)).toBeVisible({ timeout: 15_000 });
}

function readBookingIdFromSuccessURL(page: Page) {
  return new URL(page.url()).searchParams.get("bookingId");
}

async function moveBookingStartForE2E(
  request: APIRequestContext,
  bookingId: string,
  startsAt: string,
  tenantSlug = e2eTenantSlug,
) {
  const response = await request.post(apiURL(`testing/e2e/bookings/${bookingId}/move-start`), {
    data: {
      tenantSlug,
      startsAt,
    },
    headers: {
      "X-E2E-Reset-Token": e2eResetToken,
    },
  });

  await expect(response, `POST testing/e2e/bookings/${bookingId}/move-start`).toBeOK();
}

async function createPreBookingDateForm(
  request: APIRequestContext,
  tenantSlug: string,
  serviceName: string,
): Promise<{ formName: string; fieldLabel: string }> {
  const serviceResponse = await listServices(request, tenantSlug);
  const service = serviceResponse.services.find((entry) => entry.name === serviceName && entry.isActive);

  expect(service).toBeDefined();
  if (!service) {
    throw new Error(`Service ${serviceName} was not found for ${tenantSlug}.`);
  }

  const loginResponse = await request.post(apiURL("auth/login"), {
    data: {
      email: e2eDemoOwnerEmail,
      password: e2eDemoOwnerPassword,
    },
  });
  await expect(loginResponse, "POST auth/login").toBeOK();
  const loginPayload = (await loginResponse.json()) as { accessToken: string };

  const formName = `Date Click E2E ${Date.now()}`;
  const fieldLabel = "Date of last treatment";
  const createResponse = await request.post(apiURL(`tenants/${tenantSlug}/forms`), {
    data: {
      name: formName,
      scope: "customer",
      customerPromptTiming: "pre_booking",
      reviewRequired: false,
      serviceIds: [service.id],
      schema: {
        title: formName,
        description: "Regression form for date picker click behavior.",
        fields: [
          {
            id: "last-treatment-date",
            type: "date",
            label: fieldLabel,
            required: true,
          },
        ],
      },
    },
    headers: {
      Authorization: `Bearer ${loginPayload.accessToken}`,
    },
  });
  await expect(createResponse, "POST tenants/{tenantSlug}/forms").toBeOK();

  return { formName, fieldLabel };
}

test("customer can confirm a zero-deposit consultation", async ({ page, request }) => {
  test.setTimeout(60_000);

  const startedBooking = await startBookingForService(page, request, "New Client Consultation");

  expect(startedBooking.draft.status).toBe("slot_held");
  expect(startedBooking.draft.bookingMethod).toBe("public_online");

  await saveContactDetails(page, {
    name: "Consultation Guest",
    email: "consultation@example.com",
    phone: "555-0200",
  });

  await expect(page.getByText(/Reminder email and text scheduled/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm booking" })).toBeEnabled();

  await Promise.all([
    page.waitForURL(new RegExp(`/${startedBooking.tenant.slug}/book/${startedBooking.bookingDraftId}/success\\?bookingId=`)),
    page.getByRole("button", { name: "Confirm booking" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Your appointment is confirmed." })).toBeVisible({ timeout: 15_000 });

  const bookingId = readBookingIdFromSuccessURL(page);
  expect(bookingId).toBeTruthy();
  if (!bookingId) {
    throw new Error("Confirmed booking id was not present in the success URL.");
  }

  const booking = await getBooking(request, startedBooking.tenant.slug, bookingId);
  expect(booking.status).toBe("confirmed");
  expect(booking.depositStatus).toBe("not_required");
  expect(booking.paymentResolution).toBe("waived");
  expect(booking.service.name).toBe(startedBooking.service.name);
  expect(booking.provider.name).toBe(startedBooking.draft.provider.name);
  expect(booking.customer.email).toBe("consultation@example.com");

  await expectSlotConflict(request, startedBooking.tenant.slug, startedBooking.draft);
});

test("customer can open a manage link after confirmation", async ({ page, request }) => {
  test.setTimeout(60_000);

  const startedBooking = await startBookingForService(page, request, "New Client Consultation");

  await saveContactDetails(page, {
    name: "Manage Link Guest",
    email: "manage-link@example.com",
    phone: "555-0220",
  });

  await expect(page.getByRole("button", { name: "Confirm booking" })).toBeEnabled();

  await Promise.all([
    page.waitForURL(new RegExp(`/${startedBooking.tenant.slug}/book/${startedBooking.bookingDraftId}/success\\?bookingId=`)),
    page.getByRole("button", { name: "Confirm booking" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Your appointment is confirmed." })).toBeVisible({ timeout: 15_000 });
  const managePanel = page.locator(".support-panel").filter({ has: page.getByText("Need to update this visit?") });
  const manageLink = managePanel.getByRole("link", { name: "Manage booking" });

  await expect(manageLink).toHaveAttribute("href", /\/cancel\//);
  const manageHref = await manageLink.getAttribute("href");
  expect(manageHref).toBeTruthy();
  if (!manageHref) {
    throw new Error("Manage booking link href was not available on the success page.");
  }

  await page.goto(manageHref);

  await expect(page.getByRole("heading", { name: "Manage your appointment." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: startedBooking.service.name })).toBeVisible();
  await expect(page.getByText(startedBooking.draft.provider.name)).toBeVisible();
  await expect(page.getByRole("heading", { name: /cancellation window|outside cancellation window|inside cancellation window/i })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Book with ${startedBooking.tenant.name}`) })).toBeVisible();
});

test("customer can cancel a paid booking from the manage link", async ({ page, request }) => {
  test.setTimeout(90_000);

  const startedBooking = await startBookingForService(page, request, "Signature Facial", {
    targetDate: nextWeekday(3),
  });

  await saveContactDetails(page, {
    name: "Canceled Deposit Guest",
    email: "canceled-deposit@example.com",
    phone: "555-0308",
  });

  await Promise.all([
    page.waitForURL(new RegExp(`/${startedBooking.tenant.slug}/book/${startedBooking.bookingDraftId}/payment\\?sessionId=`)),
    page.getByRole("button", { name: "Continue to payment" }).click(),
  ]);

  await Promise.all([
    page.waitForURL(new RegExp(`/${startedBooking.tenant.slug}/book/${startedBooking.bookingDraftId}/success\\?bookingId=`)),
    page.getByRole("button", { name: "Pay deposit" }).click(),
  ]);

  const bookingId = readBookingIdFromSuccessURL(page);
  expect(bookingId).toBeTruthy();
  if (!bookingId) {
    throw new Error("Paid booking id was not present in the success URL.");
  }

  const managePanel = page.locator(".support-panel").filter({ has: page.getByText("Need to update this visit?") });
  const manageLink = managePanel.getByRole("link", { name: "Manage booking" });
  const manageHref = await manageLink.getAttribute("href");

  expect(manageHref).toBeTruthy();
  if (!manageHref) {
    throw new Error("Manage booking link href was not available on the success page.");
  }

  await page.goto(manageHref);

  await expect(page.getByRole("heading", { name: "Manage your appointment." })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("textbox", { name: "Reason for cancellation" }).fill("Need to move this facial to next week.");

  await Promise.all([
    page.waitForURL(/canceled=1/),
    page.getByRole("button", { name: "Cancel appointment" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Your appointment is canceled." })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".status-banner strong").filter({ hasText: "Deposit refunded:" }).first()).toBeVisible();

  const booking = await getBooking(request, startedBooking.tenant.slug, bookingId);
  expect(booking.status).toBe("canceled");
  expect(booking.depositStatus).toBe("refunded");
  expect(booking.paymentResolution).toBe("waived");
});

test("customer forfeits a paid deposit when canceling inside the window", async ({ page, request }) => {
  test.setTimeout(90_000);

  const startedBooking = await startBookingForService(page, request, "Signature Facial", {
    targetDate: nextWeekday(3),
  });

  await saveContactDetails(page, {
    name: "Forfeited Deposit Guest",
    email: "forfeited-deposit@example.com",
    phone: "555-0316",
  });

  await Promise.all([
    page.waitForURL(new RegExp(`/${startedBooking.tenant.slug}/book/${startedBooking.bookingDraftId}/payment\\?sessionId=`)),
    page.getByRole("button", { name: "Continue to payment" }).click(),
  ]);

  await Promise.all([
    page.waitForURL(new RegExp(`/${startedBooking.tenant.slug}/book/${startedBooking.bookingDraftId}/success\\?bookingId=`)),
    page.getByRole("button", { name: "Pay deposit" }).click(),
  ]);

  const bookingId = readBookingIdFromSuccessURL(page);
  expect(bookingId).toBeTruthy();
  if (!bookingId) {
    throw new Error("Paid booking id was not present in the success URL.");
  }

  const managePanel = page.locator(".support-panel").filter({ has: page.getByText("Need to update this visit?") });
  const manageLink = managePanel.getByRole("link", { name: "Manage booking" });
  const manageHref = await manageLink.getAttribute("href");

  expect(manageHref).toBeTruthy();
  if (!manageHref) {
    throw new Error("Manage booking link href was not available on the success page.");
  }

  await moveBookingStartForE2E(request, bookingId, new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), startedBooking.tenant.slug);

  await page.goto(manageHref);

  await expect(page.getByRole("heading", { name: "Manage your appointment." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Inside cancellation window" })).toBeVisible();
  await page.getByRole("textbox", { name: "Reason for cancellation" }).fill("I can no longer make it today.");

  await Promise.all([
    page.waitForURL(/canceled=1/),
    page.getByRole("button", { name: "Cancel appointment" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Your appointment is canceled." })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".status-banner strong").filter({ hasText: "Deposit retained:" }).first()).toBeVisible();

  const booking = await getBooking(request, startedBooking.tenant.slug, bookingId);
  expect(booking.status).toBe("canceled");
  expect(booking.depositStatus).toBe("forfeited");
  expect(booking.paymentResolution).toBe("collected");
});

test("customer must complete the brow pre-booking form before checkout", async ({ page, request }) => {
  test.setTimeout(60_000);

  const startedBooking = await startBookingForService(page, request, "Brow Shape and Tint");

  expect(startedBooking.draft.status).toBe("awaiting_form");
  expect(startedBooking.draft.formRequirements).toHaveLength(1);

  await saveContactDetails(page, {
    name: "Form Completion Guest",
    email: "forms@example.com",
    phone: "555-0400",
  });

  await expect(page.getByRole("button", { name: "Complete forms first" })).toBeDisabled();

  const requirementCard = page.locator(".requirement-form-card").first();
  await expect(requirementCard.getByText("Brow Prep Check-In")).toBeVisible();
  await requirementCard.getByRole("radio", { name: "No" }).check();
  await requirementCard.getByLabel(/Anything else we should know before your brow appointment/).fill("No active sensitivity.");
  await requirementCard.getByRole("button", { name: "Submit form" }).click();

  const continueToPayment = page.getByRole("button", { name: "Continue to payment" });
  await expect(continueToPayment).toBeEnabled({ timeout: 15_000 });

  const updatedDraft = await getBookingDraft(request, startedBooking.tenant.slug, startedBooking.bookingDraftId);
  expect(updatedDraft.status).toBe("slot_held");
  expect(updatedDraft.formRequirements.every((requirement) => requirement.status === "satisfied")).toBeTruthy();

  await Promise.all([
    page.waitForURL(new RegExp(`/${startedBooking.tenant.slug}/book/${startedBooking.bookingDraftId}/payment\\?sessionId=`)),
    continueToPayment.click(),
  ]);

  await expect(page.getByRole("heading", { name: "Deposit due today" })).toBeVisible({ timeout: 15_000 });

  const awaitingPaymentDraft = await getBookingDraft(request, startedBooking.tenant.slug, startedBooking.bookingDraftId);
  expect(awaitingPaymentDraft.status).toBe("awaiting_payment");
});

test("customer can complete a deposit checkout for a facial booking", async ({ page, request }) => {
  test.setTimeout(60_000);

  const startedBooking = await startBookingForService(page, request, "Signature Facial");

  expect(startedBooking.draft.status).toBe("slot_held");

  await saveContactDetails(page, {
    name: "Paid Deposit Guest",
    email: "paid-deposit@example.com",
    phone: "555-0302",
  });

  const continueToPayment = page.getByRole("button", { name: "Continue to payment" });
  await expect(continueToPayment).toBeEnabled();

  await Promise.all([
    page.waitForURL(new RegExp(`/${startedBooking.tenant.slug}/book/${startedBooking.bookingDraftId}/payment\\?sessionId=`)),
    continueToPayment.click(),
  ]);

  await expect(page.getByRole("heading", { name: "Deposit due today" })).toBeVisible({ timeout: 15_000 });

  const awaitingPaymentDraft = await getBookingDraft(request, startedBooking.tenant.slug, startedBooking.bookingDraftId);
  expect(awaitingPaymentDraft.status).toBe("awaiting_payment");

  await Promise.all([
    page.waitForURL(new RegExp(`/${startedBooking.tenant.slug}/book/${startedBooking.bookingDraftId}/success\\?bookingId=`)),
    page.getByRole("button", { name: "Pay deposit" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "Your appointment is confirmed." })).toBeVisible({ timeout: 15_000 });

  const bookingId = readBookingIdFromSuccessURL(page);
  expect(bookingId).toBeTruthy();
  if (!bookingId) {
    throw new Error("Paid booking id was not present in the success URL.");
  }

  const booking = await getBooking(request, startedBooking.tenant.slug, bookingId);
  expect(booking.status).toBe("confirmed");
  expect(booking.depositStatus).toBe("paid");
  expect(booking.paymentResolution).toBe("pending");
  expect(booking.service.name).toBe(startedBooking.service.name);
  expect(booking.provider.name).toBe(startedBooking.draft.provider.name);
  expect(booking.customer.email).toBe("paid-deposit@example.com");

  await expectSlotConflict(request, startedBooking.tenant.slug, startedBooking.draft);
});

test("customer can click inside date field in required pre-booking form", async ({ page, request }) => {
  test.setTimeout(90_000);

  const tenant = await getTenant(request, e2eTenantSlug);
  const { formName, fieldLabel } = await createPreBookingDateForm(request, tenant.slug, "Brow Shape and Tint");
  const startedBooking = await startBookingForService(page, request, "Brow Shape and Tint");

  await saveContactDetails(page, {
    name: "Date Field Guest",
    email: "date-field@example.com",
    phone: "555-0450",
  });

  const requirementCard = page.locator(".requirement-form-card").filter({
    has: page.getByText(formName),
  });
  await expect(requirementCard).toBeVisible({ timeout: 15_000 });

  const dateInput = requirementCard.getByLabel(fieldLabel);
  await dateInput.click({ position: { x: 10, y: 18 } });
  await expect(dateInput).toBeFocused();
  await dateInput.fill("2026-07-15");

  await requirementCard.getByRole("button", { name: "Submit form" }).click();

  const updatedDraft = await getBookingDraft(request, startedBooking.tenant.slug, startedBooking.bookingDraftId);
  const dateRequirement = updatedDraft.formRequirements.find((requirement) => requirement.formTitle === formName);
  expect(dateRequirement).toBeDefined();
  expect(dateRequirement?.status).toBe("satisfied");
});