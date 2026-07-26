import { test, expect } from "@playwright/test";

// Stopping a running deploy.
//
// The success path cannot be exercised here — it needs a real update in flight,
// which means a real image build. What IS testable, and matters more, is that
// the endpoint refuses when there is nothing to stop: a stop button that reports
// success against no running deploy would teach people to trust it in exactly
// the moment it does nothing.

test.describe("Update cancel", () => {
  test("refuses when no update is running", async ({ page }) => {
    await page.goto("/settings");
    const response = await page.request.post("/api/update/cancel");
    expect(response.status()).toBe(409);
    expect((await response.json()).error).toContain("kein Update");
  });

  test("the stop button is absent while nothing runs", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("update-cancel")).toHaveCount(0);
  });
});
