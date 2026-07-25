import { test, expect } from "@playwright/test";
import { E2E_RESTRICTED } from "./fixtures";
import { login } from "./helpers";

// Start unauthenticated (override the stored admin session) and log in as the
// restricted, app-less user to verify the per-user app-assignment gating.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("App access control (restricted user)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, E2E_RESTRICTED);
    await expect(page.getByText("Noch keine App freigegeben")).toBeVisible();
  });

  test("launcher shows the empty state and no app tiles", async ({ page }) => {
    await expect(page.getByRole("main").getByRole("link", { name: /Zählwerk/ })).toHaveCount(0);
  });

  test("direct navigation to an unassigned app redirects to the launcher", async ({ page }) => {
    await page.goto("/apps/zaehlwerk");
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByText("Noch keine App freigegeben")).toBeVisible();
  });

  test("navigation menu reports no released apps", async ({ page }) => {
    await page.getByRole("button", { name: "Navigation öffnen" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText("Keine Apps freigegeben")).toBeVisible();
    // Platform settings stays reachable regardless of app assignments.
    await expect(menu.getByRole("menuitem", { name: "Plattform-Einstellungen" })).toBeVisible();
  });
});
