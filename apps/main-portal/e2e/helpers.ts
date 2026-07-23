import { expect, type Page } from "@playwright/test";

// Robust login for the real /login flow. Mantine's inputs are controlled, and
// WebKit can drop a fast `fill()` before React commits the value — so we type
// the value and assert it landed before submitting.
export async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto("/login");

  const email = page.getByLabel("E-Mail");
  const password = page.getByLabel("Passwort");

  await email.click();
  await email.pressSequentially(creds.email, { delay: 10 });
  await expect(email).toHaveValue(creds.email);

  await password.click();
  await password.pressSequentially(creds.password, { delay: 10 });
  await expect(password).toHaveValue(creds.password);

  await page.getByRole("button", { name: "Anmelden" }).click();
  // Credentials → session issued → redirect to the launcher.
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
}
