import { test, expect } from "@playwright/test";

// 2FA enrolment.
//
// Regression cover for a reported failure with the Apple password manager: the
// key was transferred, saved, and every code it produced was rejected. The cause
// was not the code — it was that restarting enrolment minted a NEW key and
// overwrote the stored one, so the manager held a key the server had already
// thrown away. Switching apps to save a key and coming back is the ordinary
// mobile flow, not an edge case.

async function openEnrolment(page: import("@playwright/test").Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "2FA einrichten" }).click();
  const secret = page.getByTestId("totp-secret");
  await expect(secret).toBeVisible();
  return (await secret.textContent())?.trim() ?? "";
}

test.describe("2FA enrolment", () => {
  test("restarting enrolment keeps the key already handed out", async ({ page }) => {
    const first = await openEnrolment(page);
    expect(first).not.toHaveLength(0);

    // Leave and come back, exactly as switching to a password manager does.
    await page.getByRole("button", { name: "Schließen" }).click();
    const second = await openEnrolment(page);

    expect(second, "a resumed enrolment must not invalidate the saved key").toBe(first);
  });

  test("a full page reload also keeps it", async ({ page }) => {
    const first = await openEnrolment(page);
    await page.reload();
    const second = await openEnrolment(page);
    expect(second).toBe(first);
  });

  test("the key can be copied and names its account", async ({ page }) => {
    await openEnrolment(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Schlüssel kopieren" })).toBeVisible();
    // Scoped to the dialog: the address also sits in the (closed) user menu, so
    // an unscoped match resolves to a hidden element.
    await expect(dialog.getByText("admin@e2e.test")).toBeVisible();
  });

  test("regenerating deliberately does issue a new key", async ({ page }) => {
    const first = await openEnrolment(page);
    await page.getByRole("button", { name: "Neuen Schlüssel erzeugen" }).click();

    // The escape hatch for a half-finished transfer — it must actually change.
    await expect
      .poll(async () => (await page.getByTestId("totp-secret").textContent())?.trim())
      .not.toBe(first);
  });
});
