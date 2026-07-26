import path from "node:path";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@zaehlwerk/database";

// Instance-wide 2FA enforcement.
//
// This spec deliberately writes the setting through Prisma rather than through
// the UI switch, for one reason: turning enforcement ON gates the admin out of
// the settings page — including the switch that would turn it off. Driving it
// from the UI would leave the suite with no way back, and the E2E database is
// reused between runs. The seed clears the key as well, so even a crash here
// cannot poison the next run.

// Pointed at the E2E database EXPLICITLY. playwright.config.ts sets
// DATABASE_URL only for the dev server it spawns; this spec runs in the plain
// Playwright process, which inherits the ambient env — i.e. the development
// database. Without this the writes below land in the wrong file, the app never
// sees them, and the test fails while quietly enabling 2FA enforcement on the
// developer's own instance.
const E2E_DB = path.join(__dirname, ".data", "e2e.db").replace(/\\/g, "/");
const prisma = new PrismaClient({ datasourceUrl: `file:${E2E_DB}` });
const KEY = "security.enforceTwoFactor";

async function setEnforcement(enabled: boolean) {
  if (enabled) {
    await prisma.setting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: "true" },
      update: { value: "true" },
    });
  } else {
    await prisma.setting.deleteMany({ where: { key: KEY } });
  }
}

test.describe("2FA enforcement", () => {
  test.afterAll(async () => {
    await setEnforcement(false);
    await prisma.$disconnect();
  });

  test("the switch is off by default and the app is reachable", async ({ page }) => {
    await setEnforcement(false);
    // The switch lives on the security group's page since the settings were split.
    await page.goto("/settings/sicherheit");
    await expect(page.getByRole("heading", { name: "Sicherheit & Zugriff" })).toBeVisible();
    await expect(page.getByTestId("enforce-2fa")).not.toBeChecked();
  });

  test("an account without a second factor is gated out of every page", async ({ page }) => {
    await setEnforcement(true);

    // Not one route: the gate replaces the page content wherever you are, which
    // is the property that makes it not bypassable by picking another URL.
    for (const route of ["/", "/settings", "/settings/sicherheit", "/apps/log-analyzer"]) {
      await page.goto(route);
      await expect(
        page.getByRole("heading", { name: "Zwei-Faktor-Authentifizierung erforderlich" }),
        `gate must cover ${route}`,
      ).toBeVisible();
    }

    // The page behind it is never rendered — not hidden, absent.
    await expect(page.getByRole("heading", { name: "Plattform-Einstellungen" })).toHaveCount(0);

    // Leaving must stay possible for an account that cannot enrol.
    await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible();
  });

  test("the API refuses the same session, not just the browser", async ({ page }) => {
    await setEnforcement(true);
    await page.goto("/");

    // A gated account still holds a valid session cookie. Without the guard in
    // api-guards.ts it could drive the whole API while the UI shows the gate.
    const response = await page.request.get("/api/system/versions");
    expect(response.status()).toBe(403);
  });

  test("turning enforcement off restores access", async ({ page }) => {
    await setEnforcement(false);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Plattform-Einstellungen" })).toBeVisible();
  });
});
