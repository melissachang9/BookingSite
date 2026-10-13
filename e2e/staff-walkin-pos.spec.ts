import { expect, test, type Page } from "@playwright/test";

import {
  e2eDashboardBaseURL,
  e2eDemoOwnerEmail,
  e2eDemoOwnerPassword,
  e2eTenantSlug,
  resetE2EData,
} from "./helpers/platform-api";

// Walk-in booking paid on an unconnected POS terminal: staff hold a slot from
// the calendar, record the terminal payment with its receipt reference, and
// the booking is confirmed with that reference on the payment.
//
// Resets the demo tenant first (set E2E_SKIP_RESET=1 to skip) — do not run
// against a database whose data you want to keep.

test.beforeEach(async ({ request }) => {
  if (process.env.E2E_SKIP_RESET !== "1") {
    await resetE2EData(request, e2eTenantSlug);
  }
});

async function openCalendar(page: Page) {
  await page.goto(`${e2eDashboardBaseURL}/login`);
  await page.getByLabel("Email").fill(e2eDemoOwnerEmail);
  await page.getByLabel("Password").fill(e2eDemoOwnerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
  await page.goto(`${e2eDashboardBaseURL}/calendar`);
  await expect(page.getByRole("button", { name: "Staff filter" })).toBeVisible({ timeout: 20000 });
}

test("walk-in paid on external POS is confirmed with the receipt reference", async ({ page }) => {
  await openCalendar(page);

  // Tomorrow's column in the week view: click an open time to start a booking.
  await page.getByRole("button", { name: "Next week" }).click().catch(() => undefined);
  const track = page.getByLabel(/^(Mon|Tue|Wed|Thu|Fri) schedule track$/).first();
  await track.click({ position: { x: 20, y: 120 } });

  const drawer = page.getByRole("dialog", { name: "Calendar slot actions" });
  await expect(drawer).toBeVisible();

  await drawer.getByPlaceholder("Search clients — type a name").fill("a");
  await drawer.getByRole("button", { name: /@/ }).first().click();
  await drawer.getByRole("button", { name: "Treatment" }).click();
  await drawer.getByRole("option").first().click();

  page.once("dialog", (dialog) => void dialog.accept());
  await drawer.getByRole("button", { name: "Hold slot & collect payment" }).click();

  const collect = drawer.getByRole("region", { name: "Collect payment" });
  await expect(collect).toBeVisible({ timeout: 10000 });
  await expect(collect.getByRole("timer")).toContainText("Held");

  const record = collect.getByRole("button", { name: "Record payment & confirm" });
  await expect(record).toBeDisabled();
  await collect.getByPlaceholder("e.g. 004512").fill("APPR 77881");
  await record.click();

  await expect(drawer).toBeHidden({ timeout: 10000 });
  const details = page.getByRole("dialog", { name: "Appointment details" });
  await expect(details).toBeVisible({ timeout: 15000 });
  await expect(details.getByText(/Ref APPR 77881/)).toBeVisible();
});
