import { test, expect, type Page } from "@playwright/test";
import { E2E_FIRSTLOGIN_PASSWORD, firstLoginEmail } from "./fixtures";

// Start unauthenticated (override the stored admin session) to exercise the
// temp-password first-login + forced password-setup flow end to end.
test.use({ storageState: { cookies: [], origins: [] } });

// Mantine inputs are controlled; WebKit can drop a fast fill(), so type + assert.
async function type(page: Page, label: string, value: string) {
  const field = page.getByLabel(label);
  await field.click();
  await field.pressSequentially(value, { delay: 8 });
  await expect(field).toHaveValue(value);
}

test.describe("First login: temp-password account", () => {
  test("logs in without a password, is forced to set one, then reaches the app", async ({ page }, testInfo) => {
    const email = firstLoginEmail(testInfo.project.name);
    // Passwordless first login: e-mail only, password left blank.
    await page.goto("/login");
    await type(page, "E-Mail", email);
    await page.getByRole("button", { name: "Anmelden" }).click();

    // Forced onto the setup page.
    await page.waitForURL((url) => url.pathname === "/set-password");
    await expect(page.getByRole("heading", { name: "Passwort festlegen" })).toBeVisible();

    // The gate holds: trying to reach an app bounces back to setup.
    await page.goto("/apps/zaehlwerk");
    await page.waitForURL((url) => url.pathname === "/set-password");

    // Set a real password (with confirmation) → land in the app.
    await type(page, "Neues Passwort", E2E_FIRSTLOGIN_PASSWORD);
    await type(page, "Passwort bestätigen", E2E_FIRSTLOGIN_PASSWORD);
    await page.getByRole("button", { name: /Passwort speichern/ }).click();

    await page.waitForURL((url) => url.pathname === "/");
    // The launcher renders (gate lifted) — the placeholder tile is always shown.
    await expect(page.getByText("Weitere Apps")).toBeVisible();
  });

  test("after setup, the new password works and setup is no longer forced", async ({ page }, testInfo) => {
    // Runs after the first test in the same project, so this project's account
    // now has its password set. A normal login goes straight to the launcher.
    const email = firstLoginEmail(testInfo.project.name);
    await page.goto("/login");
    await type(page, "E-Mail", email);
    await type(page, "Passwort", E2E_FIRSTLOGIN_PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();

    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByText("Weitere Apps")).toBeVisible();
  });
});
