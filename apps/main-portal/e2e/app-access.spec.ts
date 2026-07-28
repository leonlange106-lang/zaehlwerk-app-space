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

// The edge guard (`proxy.ts`) decides who reaches an API route at all. It is
// deliberately tested from OUTSIDE, over HTTP: the ingestion route's unit tests
// call POST() directly and therefore never cross the guard — which is exactly
// how the guard came to reject every unattended ingest with a 401 while all four
// of those tests stayed green.
//
// Unauthenticated on purpose: an ingestion client is a device, not a browser.
test.describe("Edge guard: automated ingestion", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an ingestion key reaches the route instead of being turned away", async ({ request }) => {
    const response = await request.post("/api/v1/logs/ingest", {
      headers: { "X-API-Key": "zw_ing_definitely-not-a-real-key", "Content-Type": "text/csv" },
      data: "irrelevant",
    });

    // Still 401 — the key is bogus. The point is WHICH 401: the guard answers
    // {"error":"Unauthorized"}, the route answers with its own German message.
    // Getting the route's proves the request was allowed through to be judged.
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ success: false });
  });

  test("the same key opens nothing else", async ({ request }) => {
    const response = await request.get("/api/v1/meters", {
      headers: { "X-API-Key": "zw_ing_definitely-not-a-real-key" },
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });
});
