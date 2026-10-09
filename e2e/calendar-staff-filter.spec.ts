import { expect, test, type Page } from "@playwright/test";

import { e2eDashboardBaseURL, e2eDemoOwnerEmail, e2eDemoOwnerPassword } from "./helpers/platform-api";

// Regression: the staff filter menu closed on mousedown (a stale selector in its
// outside-click handler), so choosing a team member never took effect. jsdom
// can't reproduce that ordering, so this runs in a real browser. It reads only
// existing data and does not reset the database.

async function openCalendar(page: Page) {
  await page.goto(`${e2eDashboardBaseURL}/login`);
  await page.getByLabel("Email").fill(e2eDemoOwnerEmail);
  await page.getByLabel("Password").fill(e2eDemoOwnerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15000 });
  await page.goto(`${e2eDashboardBaseURL}/calendar`);
  await expect(page.getByRole("button", { name: "Staff filter" })).toBeVisible({ timeout: 20000 });
}

const weeklyCount = async (page: Page) => {
  const text = await page.getByText(/appointments this week/).innerText();
  return Number(/(\d+) appointments this week/.exec(text)?.[1] ?? "NaN");
};

test("choosing a team member filters the week to only their appointments", async ({ page }) => {
  await openCalendar(page);
  const everyone = await weeklyCount(page);

  await page.getByRole("button", { name: "Staff filter" }).click();
  const people = page.getByRole("menuitemradio").filter({ hasNotText: "All staff" });
  const total = await people.count();
  expect(total).toBeGreaterThan(1);

  // Pick the first person who has appointments this week.
  let chosen: { name: string; count: number } | null = null;
  for (let index = 0; index < total; index += 1) {
    const label = (await people.nth(index).innerText()).trim().split("\n").filter(Boolean);
    const count = Number(label[label.length - 1]);
    if (count > 0 && count < everyone) {
      chosen = { name: label[label.length - 2] ?? label[0], count };
      await people.nth(index).click();
      break;
    }
  }
  test.skip(chosen === null, "Needs two team members with appointments in the visible week.");

  // The selection sticks (menu closed, button names the person) and the week is filtered.
  await expect(page.getByRole("button", { name: "Staff filter" })).toContainText(chosen!.name);
  await expect.poll(() => weeklyCount(page)).toBe(chosen!.count);

  // Back to everyone.
  await page.getByRole("button", { name: "Staff filter" }).click();
  await page.getByRole("menuitemradio", { name: /All staff/ }).click();
  await expect.poll(() => weeklyCount(page)).toBe(everyone);
});

test("choosing a service filters the week to only that appointment type", async ({ page }) => {
  await openCalendar(page);
  const everyone = await weeklyCount(page);
  const chips = page.locator(".cs-chip");
  expect(await chips.count()).toBe(everyone);

  await page.getByRole("button", { name: "Service filter" }).click();
  const services = page.getByRole("menuitemradio").filter({ hasNotText: "Any service" });
  const total = await services.count();
  expect(total).toBeGreaterThan(0);

  // Find a service that narrows the week without emptying it.
  let narrowed: number | null = null;
  let chosen = "";
  for (let index = 0; index < total && narrowed === null; index += 1) {
    if (index > 0) await page.getByRole("button", { name: "Service filter" }).click();
    chosen = (await services.nth(index).innerText()).split("\n")[0].trim();
    await services.nth(index).click();
    await expect(page.getByRole("button", { name: "Service filter" })).toContainText(chosen);
    await expect.poll(async () => (await chips.count()) === (await weeklyCount(page))).toBe(true);
    const count = await weeklyCount(page);
    if (count > 0 && count < everyone) narrowed = count;
  }
  test.skip(narrowed === null, "Needs a service that covers only some of the week's appointments.");

  expect(await chips.count()).toBe(narrowed);

  await page.getByRole("button", { name: "Service filter" }).click();
  await page.getByRole("menuitemradio", { name: /Any service/ }).click();
  await expect.poll(() => weeklyCount(page)).toBe(everyone);
});
