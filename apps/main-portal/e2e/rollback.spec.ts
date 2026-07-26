import { test, expect } from "@playwright/test";

// Rolling back to an earlier version.
//
// The success path is deliberately NOT exercised here: it would spawn
// scripts/update.sh, which rebuilds an image and recreates containers. What CAN
// and must be tested is the refusal — the endpoint builds and runs whatever ref
// it accepts, so "an arbitrary ref is rejected" is the property that keeps a
// hijacked admin session from becoming remote code execution.

test.describe("Version rollback", () => {
  test("the card renders with its database warning from first paint", async ({ page }) => {
    await page.goto("/settings/system");

    const card = page.getByTestId("version-history");
    await expect(card).toBeVisible();

    // The consequence has to be readable BEFORE any button is pressed — this is
    // the one part of the feature that cannot be undone by pressing it again.
    await expect(card.getByText("Die Datenbank wandert nicht mit zurück")).toBeVisible();
  });

  test("an unoffered ref is refused instead of deployed", async ({ page }) => {
    // Authenticated as the seeded admin via the project's storageState, so a 400
    // here is the whitelist talking, not the auth guard.
    await page.goto("/settings/system");

    for (const ref of ["main", "refs/pull/1/merge", "HEAD", "../../etc/passwd"]) {
      const response = await page.request.post("/api/update/rollback", {
        data: { ref },
      });
      expect(response.status(), `ref "${ref}" must not start a deploy`).toBe(400);
    }
  });

  test("a request without a ref is refused", async ({ page }) => {
    await page.goto("/settings/system");
    const response = await page.request.post("/api/update/rollback", { data: {} });
    expect(response.status()).toBe(400);
  });
});
