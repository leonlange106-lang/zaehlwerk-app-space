import { test as setup, expect } from "@playwright/test";
import { E2E_ADMIN } from "./fixtures";
import { login } from "./helpers";

const authFile = "e2e/.auth/state.json";

// Logs in once through the real login flow and persists the session so every
// mobile project starts authenticated (the launcher and app routes are gated).
setup("authenticate", async ({ page }) => {
  await login(page, E2E_ADMIN);
  // Admin sees the launcher (placeholder tile is always present).
  await expect(page.getByText("Weitere Apps")).toBeVisible();
  await page.context().storageState({ path: authFile });
});
