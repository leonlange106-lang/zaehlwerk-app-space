import { expect, type Page } from "@playwright/test";

// Robust login for the real /login flow. The inputs are controlled, and WebKit
// can drop a fast `fill()` before React commits the value — so we type the value
// and assert it landed before submitting.
//
// Located by ROLE, not by label. Two reasons, both learned the hard way:
//   - getByLabel matches the label's text CONTENT, which includes the required
//     marker — the accessible name is "E-Mail", the label text is "E-Mail*".
//   - the password field's reveal toggle is labelled "Passwort anzeigen", so a
//     substring label match resolves to two elements.
// The accessible name has neither problem, and the button is not a textbox.
export async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto("/login");

  const email = page.getByRole("textbox", { name: "E-Mail", exact: true });
  const password = page.getByRole("textbox", { name: "Passwort", exact: true });

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
