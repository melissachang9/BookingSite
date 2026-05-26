import { expect, test } from "@playwright/test";

import {
  e2eDashboardBaseURL,
  e2eDemoOwnerEmail,
  e2eDemoOwnerPassword,
} from "./helpers/platform-api";

const dashboardSessionStorageKey = "booking.dashboard.session";
const dashboardRedirectPathStorageKey = "booking.dashboard.redirect-path";

async function signInAsDemoOwner(page: Parameters<typeof test>[0]["page"]) {
  await page.goto(`${e2eDashboardBaseURL}/login`);
  await expect(page.getByRole("heading", { name: "Sign in to Studio OS" })).toBeVisible();
  await page.getByLabel("Email").fill(e2eDemoOwnerEmail);
  await page.getByLabel("Password").fill(e2eDemoOwnerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("dashboard session handling", () => {
  test("refreshes an expired operator session before loading protected data", async ({ page }) => {
    await signInAsDemoOwner(page);

    await page.evaluate((storageKey) => {
      const rawSession = window.localStorage.getItem(storageKey);
      if (!rawSession) {
        throw new Error("Dashboard session was not found in localStorage.");
      }

      const session = JSON.parse(rawSession) as {
        expiresAt: string;
      };
      session.expiresAt = new Date(Date.now() - 60_000).toISOString();
      window.localStorage.setItem(storageKey, JSON.stringify(session));
    }, dashboardSessionStorageKey);

    const refreshCheckStartedAt = Date.now();

    await page.goto(`${e2eDashboardBaseURL}/services`);
    await expect(page.getByRole("heading", { name: "Create tenant-scoped service" })).toBeVisible();

    await expect
      .poll(async () => page.evaluate((storageKey) => {
        const rawSession = window.localStorage.getItem(storageKey);
        if (!rawSession) {
          return 0;
        }

        const session = JSON.parse(rawSession) as {
          expiresAt: string;
        };
        return Date.parse(session.expiresAt);
      }, dashboardSessionStorageKey))
      .toBeGreaterThan(refreshCheckStartedAt);
  });

  test("clears the operator session and returns to login when refresh fails", async ({ page }) => {
    await signInAsDemoOwner(page);

    await page.evaluate((storageKey) => {
      const rawSession = window.localStorage.getItem(storageKey);
      if (!rawSession) {
        throw new Error("Dashboard session was not found in localStorage.");
      }

      const session = JSON.parse(rawSession) as {
        refreshToken?: string;
        expiresAt: string;
      };
      session.refreshToken = "invalid-refresh-token";
      session.expiresAt = new Date(Date.now() - 60_000).toISOString();
      window.localStorage.setItem(storageKey, JSON.stringify(session));
    }, dashboardSessionStorageKey);

    await page.goto(`${e2eDashboardBaseURL}/services`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in to Studio OS" })).toBeVisible();
    await expect(page.getByText("Your session expired. Sign in again to continue.")).toBeVisible();

    const redirectPath = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), dashboardRedirectPathStorageKey);
    expect(redirectPath).toBe("/services");

    const storedSession = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), dashboardSessionStorageKey);
    expect(storedSession).toBeNull();
  });

  test("returns the operator to the last protected route after re-login", async ({ page }) => {
    await signInAsDemoOwner(page);

    await page.evaluate((storageKey) => {
      const rawSession = window.localStorage.getItem(storageKey);
      if (!rawSession) {
        throw new Error("Dashboard session was not found in localStorage.");
      }

      const session = JSON.parse(rawSession) as {
        refreshToken?: string;
        expiresAt: string;
      };
      session.refreshToken = "invalid-refresh-token";
      session.expiresAt = new Date(Date.now() - 60_000).toISOString();
      window.localStorage.setItem(storageKey, JSON.stringify(session));
    }, dashboardSessionStorageKey);

    await page.goto(`${e2eDashboardBaseURL}/services`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Your session expired. Sign in again to continue.")).toBeVisible();

    await page.getByLabel("Email").fill(e2eDemoOwnerEmail);
    await page.getByLabel("Password").fill(e2eDemoOwnerPassword);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/services$/);
    await expect(page.getByRole("heading", { name: "Create tenant-scoped service" })).toBeVisible();

    const redirectPath = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), dashboardRedirectPathStorageKey);
    expect(redirectPath).toBeNull();
  });
});