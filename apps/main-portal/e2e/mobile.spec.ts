import { test, expect, type Locator, type Page } from "@playwright/test";
import { CORE_ROUTES, E2E_METER_NAME, ERROR_BOUNDARY_TEXT } from "./fixtures";

async function expectRendered(page: Page) {
  // A page that fell into the route error boundary (500) shows this — assert it
  // did not, so goto()'s tolerance of HTTP 500 can't mask a broken page.
  await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
}

const MIN_TAP = 44;
const TAP_EPS = 0.5; // sub-pixel tolerance for boundingBox rounding

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  // +1 tolerates sub-pixel rounding; anything more is a real overflow.
  expect(scrollWidth, `viewport must not scroll horizontally (sw ${scrollWidth} vs iw ${innerWidth})`).toBeLessThanOrEqual(
    innerWidth + 1,
  );
}

async function expectTapTarget(locator: Locator, label: string) {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a box`).not.toBeNull();
  expect(box!.width, `${label} width ≥ ${MIN_TAP}`).toBeGreaterThanOrEqual(MIN_TAP - TAP_EPS);
  expect(box!.height, `${label} height ≥ ${MIN_TAP}`).toBeGreaterThanOrEqual(MIN_TAP - TAP_EPS);
}

/** Navigate to the seeded meter's detail page and return once loaded. */
async function gotoMeterDetail(page: Page) {
  await page.goto("/apps/zaehlwerk/zaehler");
  await page.getByRole("link", { name: new RegExp(E2E_METER_NAME) }).first().click();
  await page.waitForURL(/\/apps\/zaehlwerk\/zaehler\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: E2E_METER_NAME })).toBeVisible();
}

test.describe("Mobile: no horizontal viewport scroll", () => {
  for (const route of CORE_ROUTES) {
    test(`renders without error + no horizontal scroll on ${route}`, async ({ page }) => {
      await page.goto(route);
      // Let layout settle (fonts, async content).
      await page.waitForLoadState("networkidle");
      await expectRendered(page);
      await expectNoHorizontalScroll(page);
    });
  }

  test("no horizontal scroll on meter detail (wide history table is contained)", async ({ page }) => {
    await gotoMeterDetail(page);
    await page.waitForLoadState("networkidle");
    await expectRendered(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("Mobile: navigation drawer", () => {
  test("burger opens and closes the sidebar; scrim tap closes without navigating", async ({ page }) => {
    await page.goto("/apps/zaehlwerk");
    const burger = page.getByRole("button", { name: "Navigation umschalten" });
    await expect(burger).toBeVisible();
    await expect(burger).toHaveAttribute("aria-expanded", "false");

    // Nav link sits off-screen (translated left) while closed.
    const berichte = page.getByRole("link", { name: "Berichte" });
    const closedBox = await berichte.boundingBox();
    expect(closedBox, "nav link renders").not.toBeNull();
    expect(closedBox!.x, "drawer closed → nav off-screen left").toBeLessThan(0);

    await burger.click();
    await expect(burger).toHaveAttribute("aria-expanded", "true");
    const openBox = await berichte.boundingBox();
    expect(openBox!.x, "drawer open → nav on-screen").toBeGreaterThanOrEqual(0);

    // The mobile drawer must NOT be full-width — a tappable scrim strip has to
    // remain beside it, otherwise tap-outside-to-close is impossible.
    const navBox = await page.locator(".mantine-AppShell-navbar").boundingBox();
    const vw = page.viewportSize()!.width;
    expect(navBox!.x + navBox!.width, "drawer leaves a scrim strip").toBeLessThan(vw - 20);

    // Tapping the scrim (beside the drawer) must close it, not fall through.
    const urlBefore = page.url();
    const x = Math.round((navBox!.x + navBox!.width + vw) / 2);
    await page.mouse.click(x, 320);
    await expect(burger).toHaveAttribute("aria-expanded", "false");
    expect(page.url(), "scrim tap does not navigate").toBe(urlBefore);
  });

  test("nav link inside the open drawer navigates", async ({ page }) => {
    await page.goto("/apps/zaehlwerk");
    await page.getByRole("button", { name: "Navigation umschalten" }).click();
    await page.getByRole("link", { name: "Berichte" }).click();
    await page.waitForURL(/\/apps\/zaehlwerk\/berichte$/);
  });
});

test.describe("Mobile: app switcher", () => {
  test("grid opens the switcher and can jump between apps (popover on top, tappable)", async ({ page }) => {
    await page.goto("/");
    const switcher = page.getByRole("button", { name: "App wechseln" });
    await expectTapTarget(switcher, "app-switcher");
    await switcher.click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Plattform-Einstellungen")).toBeVisible();

    await menu.getByRole("menuitem", { name: "Zählwerk", exact: true }).click();
    await page.waitForURL(/\/apps\/zaehlwerk$/);
  });
});

test.describe("Mobile: modals & forms", () => {
  test("edit-reading modal fits: Speichern/Abbrechen reachable, not cut off", async ({ page }) => {
    await gotoMeterDetail(page);
    await page.getByRole("button", { name: "Ablesung bearbeiten" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const save = dialog.getByRole("button", { name: "Speichern" });
    const cancel = dialog.getByRole("button", { name: "Abbrechen" });
    await expect(save).toBeInViewport();
    await expect(cancel).toBeInViewport();
    await expectNoHorizontalScroll(page);

    await cancel.click();
    await expect(dialog).toBeHidden();
  });

  test("create reading via the inline form", async ({ page }) => {
    await gotoMeterDetail(page);
    await page.getByLabel("Zählerstand (kWh)").fill("2000");
    await page.getByRole("button", { name: "Ablesung speichern" }).click();
    await expect(page.getByText("Ablesung wurde erfasst.")).toBeVisible();
  });

  test("delete meter surfaces a confirmation (dismiss keeps the meter)", async ({ page }) => {
    await gotoMeterDetail(page);
    let dialogMessage = "";
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      return dialog.dismiss();
    });
    await page.getByRole("button", { name: "Löschen", exact: true }).click();
    await expect.poll(() => dialogMessage).toContain("endgültig löschen");
    // Dismissed → still on the detail page.
    await expect(page.getByRole("heading", { name: E2E_METER_NAME })).toBeVisible();
  });
});

test.describe("Mobile: touch targets ≥ 44px", () => {
  test("header controls meet the minimum", async ({ page }) => {
    await page.goto("/apps/zaehlwerk");
    await expectTapTarget(page.getByRole("button", { name: "Navigation umschalten" }), "burger");
    await expectTapTarget(page.getByRole("button", { name: "App wechseln" }), "app-switcher");
    await expectTapTarget(page.getByRole("button", { name: "Theme wechseln" }), "theme-toggle");
    await expectTapTarget(page.getByRole("button", { name: "Benachrichtigungen" }), "notifications");
    await expectTapTarget(page.getByRole("button", { name: "Benutzermenü" }), "user-menu");
  });

  test("drawer nav links and launcher tiles meet the minimum", async ({ page }) => {
    await page.goto("/apps/zaehlwerk");
    await page.getByRole("button", { name: "Navigation umschalten" }).click();
    await expectTapTarget(page.getByRole("link", { name: "Berichte" }), "nav: Berichte");

    await page.goto("/");
    const tile = page.getByRole("main").getByRole("link", { name: /Zählwerk/ });
    await expectTapTarget(tile, "launcher tile: Zählwerk");
  });
});
