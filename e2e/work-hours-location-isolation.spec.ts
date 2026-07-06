import { expect, test } from "@playwright/test";

import {
  e2eDashboardBaseURL,
  e2eDemoOwnerEmail,
  e2eDemoOwnerPassword,
  e2eTenantSlug,
  resetE2EData,
} from "./helpers/platform-api";

async function signInAsDemoOwner(page: Parameters<typeof test>[0]["page"]) {
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

test("work hours tab loads with all expected UI elements", async ({ page }) => {
  await signInAsDemoOwner(page);

  await page.getByRole("button", { name: "Settings & Management" }).click();
  await page
    .getByRole("navigation", { name: "Dashboard sections" })
    .getByRole("link", { name: "Staff" })
    .click();

  await expect(page.getByRole("button", { name: /Melissa Chang/i })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: /Melissa Chang/i }).click();

  await page.getByRole("tab", { name: "Work hours" }).click();
  await expect(page.getByText("Regular weekly hours")).toBeVisible({ timeout: 10000 });

  await expect(page.getByText("Hours per week")).toBeVisible();
  await expect(page.getByText("Working days")).toBeVisible();

  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
    await expect(page.getByText(day)).toBeVisible();
  }

  await expect(page.getByRole("button", { name: "Save schedule" })).toBeVisible();
  await expect(page.getByText("Date overrides")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add override" })).toBeVisible();
});

test("work hours Monday toggle is present and clickable", async ({ page }) => {
  await signInAsDemoOwner(page);

  await page.getByRole("button", { name: "Settings & Management" }).click();
  await page
    .getByRole("navigation", { name: "Dashboard sections" })
    .getByRole("link", { name: "Staff" })
    .click();

  await expect(page.getByRole("button", { name: /Melissa Chang/i })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: /Melissa Chang/i }).click();

  await page.getByRole("tab", { name: "Work hours" }).click();
  await expect(page.getByText("Regular weekly hours")).toBeVisible({ timeout: 10000 });

  // Verify Monday toggle exists
  const mondayToggle = page.getByLabel("Monday toggle");
  await expect(mondayToggle).toBeVisible({ timeout: 5000 });

  // Click the hidden checkbox inside the toggle label
  const mondayCheckbox = mondayToggle.locator("input[type=checkbox]");
  await mondayCheckbox.check({ force: true });

  // Monday inputs should appear
  const mondayInputs = page.locator(".svc-override-row").filter({ hasText: "Monday" }).locator("input[type=text]");
  await expect(mondayInputs.first()).toBeVisible({ timeout: 10000 });
});
