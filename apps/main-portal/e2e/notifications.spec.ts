import path from "node:path";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@zaehlwerk/database";

// Paket F: the bell in the header.
//
// It used to be a button with an aria-label and no handler. What it reports is
// DERIVED from conditions the platform already tracks, so this spec creates the
// conditions in the database and requires the bell to notice — and, just as
// importantly, to stay quiet when nothing is wrong. A bell that always has
// something in it is one nobody looks at.

const E2E_DB = path.join(__dirname, ".data", "e2e.db").replace(/\\/g, "/");
const prisma = new PrismaClient({ datasourceUrl: `file:${E2E_DB}` });

async function setSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function clearSettings(keys: string[]) {
  await prisma.setting.deleteMany({ where: { key: { in: keys } } });
}

const BACKUP_KEYS = ["backup.autoEnabled", "backup.intervalHours", "backup.lastRunAt"];

/** Read markers are stored per user under this prefix. */
async function clearReadMarkers() {
  await prisma.setting.deleteMany({ where: { key: { startsWith: "notifications.read." } } });
}

test.describe("Notification bell", () => {
  test.beforeEach(async () => {
    await clearSettings(BACKUP_KEYS);
    await clearReadMarkers();
  });

  test.afterAll(async () => {
    await clearSettings(BACKUP_KEYS);
    await clearReadMarkers();
    await prisma.$disconnect();
  });

  test("says everything is fine when nothing is wrong", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("notification-bell").click();
    const drawer = page.getByTestId("notification-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Alles in Ordnung");
    // No badge, because there is nothing to count.
    await expect(page.getByTestId("notification-count")).toHaveCount(0);
  });

  test("an automatic backup that never ran is reported", async ({ page }) => {
    await setSetting("backup.autoEnabled", "true");
    await setSetting("backup.intervalHours", "24");

    await page.goto("/");
    await expect(page.getByTestId("notification-count")).toBeVisible();

    await page.getByTestId("notification-bell").click();
    const drawer = page.getByTestId("notification-drawer");
    await expect(drawer).toContainText("Noch kein automatisches Backup");

    // The item leads somewhere you can act on it.
    await drawer.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/settings\/daten$/);

    // Same reason as below: let the mark-as-read write land before this test
    // ends, so it cannot bleed into the next one's cleanup.
    await expect
      .poll(async () => {
        const row = await prisma.setting.findFirst({
          where: { key: { startsWith: "notifications.read." } },
        });
        return row?.value ?? "";
      })
      .toContain("backup:never");
  });

  test("a backup switched OFF is never reported, however old", async ({ page }) => {
    // Off is a decision, not a fault. Reporting it would train people to ignore
    // the bell — which costs the notifications that do matter.
    await setSetting("backup.autoEnabled", "false");
    await setSetting("backup.lastRunAt", "2020-01-01T00:00:00.000Z");

    await page.goto("/");
    await page.getByTestId("notification-bell").click();
    await expect(page.getByTestId("notification-drawer")).toContainText("Alles in Ordnung");
  });

  test("an overdue backup is reported and names how late it is", async ({ page }) => {
    await setSetting("backup.autoEnabled", "true");
    await setSetting("backup.intervalHours", "24");
    await setSetting(
      "backup.lastRunAt",
      new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString(),
    );

    await page.goto("/");
    await page.getByTestId("notification-bell").click();
    const drawer = page.getByTestId("notification-drawer");
    await expect(drawer).toContainText("Automatisches Backup überfällig");
    await expect(drawer, "the message must say how late, not just that it is").toContainText(
      "4 Tagen",
    );
  });

  test("opening the drawer marks it read, and it stays read across a reload", async ({ page }) => {
    await setSetting("backup.autoEnabled", "true");
    await setSetting("backup.intervalHours", "24");

    // Cleared again HERE, not only in beforeEach: marking-as-read is fired from
    // the client and settles on its own schedule, so a previous test's write can
    // still be in flight when this one starts and would land after the cleanup —
    // leaving this test with a badge that was already read.
    await clearReadMarkers();

    await page.goto("/");
    await expect(page.getByTestId("notification-count")).toBeVisible();

    await page.getByTestId("notification-bell").click();
    await expect(page.getByTestId("notification-drawer")).toBeVisible();
    await expect(page.getByTestId("notification-count")).toHaveCount(0);

    // Persisted server-side, not in this tab: an unread badge that returns on
    // every reload is a nag, not a notification.
    await page.reload();
    await expect(page.getByTestId("notification-count")).toHaveCount(0);

    // The item itself is still there — read is not the same as resolved.
    await page.getByTestId("notification-bell").click();
    await expect(page.getByTestId("notification-drawer")).toContainText(
      "Noch kein automatisches Backup",
    );

    // Let the mark-as-read write finish before this test ends. It is fired from
    // the client and settles on its own schedule, so without waiting it can land
    // after the NEXT test's cleanup and silence a condition that test just
    // created — a failure that looks like a product bug and is not one.
    await expect
      .poll(async () => {
        const row = await prisma.setting.findFirst({
          where: { key: { startsWith: "notifications.read." } },
        });
        return row?.value ?? "";
      })
      .toContain("backup:never");
  });

  // NOT covered here: "a marker for condition A does not silence condition B".
  // Driving it through the UI means clicking the bell, waiting for a client-fired
  // write to land, and only then changing the condition — a race this spec lost
  // repeatedly for reasons that had nothing to do with the behaviour. The
  // property is a pure one and is asserted directly in notifications.test.ts
  // ("keys the id on ...", unreadCount/pruneReadIds), which is the right level
  // for it: read markers are ids, not a timestamp watermark.

  test("the API refuses an anonymous caller", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const response = await context.request.get("/api/notifications");
    expect(response.status()).toBe(401);
    await context.close();
  });
});
