import { test, expect, type Locator, type Page } from "@playwright/test";
import { CORE_ROUTES, E2E_METER_NAME, ERROR_BOUNDARY_TEXT } from "./fixtures";

async function expectRendered(page: Page) {
  // A page that fell into the route error boundary (500) shows this — assert it
  // did not, so goto()'s tolerance of HTTP 500 can't mask a broken page.
  await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
}

/**
 * Wait until the page is laid out enough to measure.
 *
 * Deliberately NOT `waitForLoadState("networkidle")`: the Log Analyzer history
 * page holds an SSE connection open for realtime ingest events, so the network
 * never goes idle and the wait can only ever time out. It raced the connection
 * being established, which is why it failed on a different browser each run.
 * `load` plus the main landmark is deterministic, and layout width — the thing
 * these tests assert on — is settled by then: anything arriving later has to
 * reserve its geometry up front anyway (the CLS rule in CLAUDE.md).
 */
async function waitForLayout(page: Page) {
  await page.waitForLoadState("load");
  await expect(page.getByRole("main")).toBeVisible();
}

const MIN_TAP = 44;
const TAP_EPS = 0.5; // sub-pixel tolerance for boundingBox rounding

/**
 * Measured against `documentElement.clientWidth`, NOT `window.innerWidth`: when
 * a mobile page overflows, Chrome widens the layout viewport and `innerWidth`
 * grows with it, so the comparison stayed true while the page really did scroll
 * sideways. `clientWidth` stays at the device width.
 */
async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // +1 tolerates sub-pixel rounding; anything more is a real overflow.
  expect(
    scrollWidth,
    `viewport must not scroll horizontally (sw ${scrollWidth} vs client ${clientWidth})`,
  ).toBeLessThanOrEqual(clientWidth + 1);
}

/**
 * Asserts the RESTING size of a tap target.
 *
 * Polled rather than measured once: menus and dialogs animate in with a 95%
 * zoom, so a single measurement taken during those ~150ms reports a target
 * a couple of pixels short of its real size. Polling still requires the element
 * to actually reach 44px — it only tolerates the entrance getting there.
 */
async function expectTapTarget(locator: Locator, label: string) {
  await expect(locator, `${label} should be visible`).toBeVisible();
  await expect
    .poll(async () => (await locator.boundingBox())?.width ?? 0, {
      message: `${label} width ≥ ${MIN_TAP}`,
    })
    .toBeGreaterThanOrEqual(MIN_TAP - TAP_EPS);
  await expect
    .poll(async () => (await locator.boundingBox())?.height ?? 0, {
      message: `${label} height ≥ ${MIN_TAP}`,
    })
    .toBeGreaterThanOrEqual(MIN_TAP - TAP_EPS);
}

/** Navigate to the seeded meter's detail page and return once loaded. */
async function gotoMeterDetail(page: Page) {
  await page.goto("/apps/zaehlwerk/zaehler");
  await page.getByRole("link", { name: new RegExp(E2E_METER_NAME) }).first().click();
  await page.waitForURL(/\/apps\/zaehlwerk\/zaehler\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: E2E_METER_NAME })).toBeVisible();
}

/**
 * Below `sm` the detail page shows one section at a time behind a pill bar
 * (Verlauf / Erfassen / Verwalten) instead of one very long vertical stack.
 * "Verlauf" is the landing section, so only the other two need selecting.
 */
async function selectDetailPane(page: Page, label: "Verlauf" | "Erfassen" | "Verwalten") {
  // Mantine renders the segment's <input type="radio"> visually hidden and puts
  // the hit area on the label, so the click has to land on the text. Scoped to
  // the radiogroup because "Verlauf" is also a card heading on this page.
  await page.getByRole("radiogroup", { name: "Bereich wählen" }).getByText(label).click();
}

test.describe("Mobile: no horizontal viewport scroll", () => {
  for (const route of CORE_ROUTES) {
    test(`renders without error + no horizontal scroll on ${route}`, async ({ page }) => {
      await page.goto(route);
      await waitForLayout(page);
      await expectRendered(page);
      await expectNoHorizontalScroll(page);
    });
  }

  test("no horizontal scroll on meter detail (wide history table is contained)", async ({ page }) => {
    await gotoMeterDetail(page);
    await waitForLayout(page);
    await expectRendered(page);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("Mobile: navigation menu", () => {
  test("one menu drills app → section → meter and jumps across apps", async ({ page }) => {
    // Start inside the Log Analyzer: the point of the unified menu is that you can
    // reach a Zählwerk meter from here without going via the Zählwerk dashboard.
    await page.goto("/apps/log-analyzer");
    await page.getByRole("button", { name: "Navigation öffnen" }).click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    // Opens on the app you are IN, so its own sections are one tap away.
    await expect(menu.getByRole("menuitem", { name: "Virtueller Prüfstand" })).toBeVisible();

    // The back row is labelled with the level you are in; it leads to the root.
    await menu.getByRole("menuitem", { name: "Log Analyzer", exact: true }).click();
    await expect(menu.getByRole("menuitem", { name: "Plattform-Einstellungen" })).toBeVisible();

    await menu.getByRole("menuitem", { name: "Zählwerk", exact: true }).click();
    await expect(menu.getByRole("menuitem", { name: "Berichte" })).toBeVisible();

    await menu.getByRole("menuitem", { name: "Zähler", exact: true }).click();
    // Meters are fetched on first open of this level, so wait for one to land.
    const meter = menu.getByRole("menuitem", { name: new RegExp(E2E_METER_NAME) });
    await expect(meter).toBeVisible();

    await meter.click();
    await page.waitForURL(/\/apps\/zaehlwerk\/zaehler\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: E2E_METER_NAME })).toBeVisible();
  });

  test("the menu opens on the current app and back leads to the root", async ({ page }) => {
    await page.goto("/apps/zaehlwerk");
    const trigger = page.getByRole("button", { name: "Navigation öffnen" });
    await trigger.click();

    const menu = page.getByRole("menu");
    // Inside Zählwerk: its sections, not the app list.
    await expect(menu.getByRole("menuitem", { name: "Berichte" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Plattform-Einstellungen" })).toHaveCount(0);

    // Back is one level up, to the root.
    await menu.getByRole("menuitem", { name: "Zählwerk", exact: true }).click();
    await expect(menu.getByRole("menuitem", { name: "Plattform-Einstellungen" })).toBeVisible();

    // Reopening returns to the level of the CURRENT page — not the root, and not
    // wherever the last session happened to leave off.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await trigger.click();
    await expect(page.getByRole("menu").getByRole("menuitem", { name: "Berichte" })).toBeVisible();
  });

  test("outside an app the menu opens at the root", async ({ page }) => {
    // The launcher belongs to no app, so there is no app level to prefer.
    await page.goto("/");
    await page.getByRole("button", { name: "Navigation öffnen" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Plattform-Einstellungen" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "App Space (Start)" })).toBeVisible();
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
    await selectDetailPane(page, "Erfassen");
    await page.getByLabel("Zählerstand (kWh)").fill("2000");
    await page.getByRole("button", { name: "Ablesung speichern" }).click();
    await expect(page.getByText("Ablesung wurde erfasst.")).toBeVisible();
  });

  test("delete meter surfaces a confirmation (dismiss keeps the meter)", async ({ page }) => {
    await gotoMeterDetail(page);
    await selectDetailPane(page, "Verwalten");
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
    await expectTapTarget(page.getByRole("button", { name: "Navigation öffnen" }), "app-menu");
    await expectTapTarget(page.getByRole("button", { name: "Theme wechseln" }), "theme-toggle");
    await expectTapTarget(page.getByRole("button", { name: "Benachrichtigungen" }), "notifications");
    await expectTapTarget(page.getByRole("button", { name: "Benutzermenü" }), "user-menu");
  });

  test("menu rows and launcher tiles meet the minimum", async ({ page }) => {
    await page.goto("/apps/zaehlwerk");
    await page.getByRole("button", { name: "Navigation öffnen" }).click();
    // Already on Zählwerk's level — the menu opens on the app you are in.
    await expectTapTarget(
      page.getByRole("menu").getByRole("menuitem", { name: "Berichte" }),
      "menu: Berichte",
    );
    await page.keyboard.press("Escape");

    await page.goto("/");
    const tile = page.getByRole("main").getByRole("link", { name: /Zählwerk/ });
    await expectTapTarget(tile, "launcher tile: Zählwerk");
  });
});
