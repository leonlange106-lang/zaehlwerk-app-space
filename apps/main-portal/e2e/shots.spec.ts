import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Screenshot sweep for the 3.0.0 UI review: every screen, both viewports, both
// colour schemes. Not a regression guard — it asserts nothing beyond "the page
// rendered" — so it lives behind its own config (shots.config.ts) and never runs
// with the suite.
//
// Run: pnpm exec playwright test -c e2e/shots.config.ts

const OUT = path.join(__dirname, ".shots");

interface Shot {
  slug: string;
  url: string;
  /** Something that only exists once the page is really painted. */
  ready?: (page: Page) => Promise<void>;
  /** Extra interaction before the shot (open a dialog, load a log, …). */
  setup?: (page: Page) => Promise<void>;
  /**
   * Capture just this `data-testid` instead of the whole page. For one card on
   * a long screen — the settings page is over 13000px tall on a phone, so a
   * full-page shot of it shows a component at postage-stamp size.
   */
  element?: string;
}

const SAMPLE_BUTTON = "Beispiel laden";

const SHOTS: Shot[] = [
  {
    slug: "01-launcher",
    url: "/",
    ready: (page) => expect(page.getByText("Weitere Apps")).toBeVisible(),
  },
  {
    slug: "02-zaehlwerk-dashboard",
    url: "/apps/zaehlwerk",
    ready: (page) => expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible(),
  },
  {
    slug: "03-zaehler-uebersicht",
    url: "/apps/zaehlwerk/zaehler",
    ready: (page) => expect(page.getByRole("main")).toBeVisible(),
  },
  {
    slug: "04-berichte",
    url: "/apps/zaehlwerk/berichte",
    ready: (page) => expect(page.getByRole("main")).toBeVisible(),
  },
  {
    slug: "05-zaehlwerk-einstellungen",
    url: "/apps/zaehlwerk/einstellungen",
    ready: (page) => expect(page.getByRole("main")).toBeVisible(),
  },
  {
    slug: "06-analyzer-leer",
    url: "/apps/log-analyzer",
    ready: (page) => expect(page.getByTestId("dropzone")).toBeVisible(),
  },
  {
    slug: "07-analyzer-log",
    url: "/apps/log-analyzer",
    setup: async (page) => {
      await page.getByRole("button", { name: SAMPLE_BUTTON }).click();
      await expect(page.getByText("WBSDEMO0SYNTHETIC1")).toBeVisible({ timeout: 30_000 });
      await page.locator(".recharts-surface").first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
    },
  },
  {
    slug: "08-analyzer-historie",
    url: "/apps/log-analyzer/history",
    ready: (page) => expect(page.getByRole("main")).toBeVisible(),
  },
  {
    slug: "09-analyzer-vergleich",
    url: "/apps/log-analyzer/compare",
    ready: (page) => expect(page.getByTestId("history-a")).toBeVisible({ timeout: 30_000 }),
  },
  {
    slug: "10-analyzer-pruefstand",
    url: "/apps/log-analyzer/dyno",
    ready: (page) => expect(page.getByTestId("dyno-history")).toBeVisible({ timeout: 30_000 }),
  },
  {
    slug: "11-analyzer-fahrzeug",
    url: "/apps/log-analyzer/specs",
    ready: (page) => expect(page.getByRole("main")).toBeVisible(),
  },
  {
    slug: "12-analyzer-remote",
    url: "/apps/log-analyzer/remote",
    ready: (page) => expect(page.getByRole("main")).toBeVisible(),
  },
  {
    slug: "13-einstellungen",
    url: "/settings",
    ready: (page) => expect(page.getByRole("main")).toBeVisible(),
  },
  {
    slug: "14-changelog",
    url: "/changelog",
    ready: (page) => expect(page.getByRole("heading", { name: "Changelog" })).toBeVisible(),
  },
  {
    slug: "16-version-rollback",
    url: "/settings",
    element: "version-history",
    // Wait for the LIST, not the card. The card paints immediately with skeleton
    // rows (it reserves its geometry), so anything that also matches the loading
    // state resolves at once and captures placeholders.
    ready: (page) => expect(page.getByTestId("version-list")).toBeVisible({ timeout: 30_000 }),
  },
  {
    slug: "17-version-rollback-dialog",
    url: "/settings",
    element: "rollback-confirm",
    ready: (page) => expect(page.getByTestId("version-list")).toBeVisible({ timeout: 30_000 }),
    setup: async (page) => {
      await page.getByTestId("rollback-select").first().click();
      await expect(page.getByTestId("rollback-confirm")).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  {
    slug: "15-menue",
    url: "/apps/zaehlwerk",
    setup: async (page) => {
      await page.getByRole("button", { name: "Navigation öffnen" }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
];

// The login page is the one screen the stored admin session hides, so it gets a
// context of its own.
test.describe("login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const scheme of ["dark", "light"] as const) {
    test(`00-login (${scheme})`, async ({ page }, testInfo) => {
      await setScheme(page, scheme);
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
      await page.waitForTimeout(300);
      await save(page, testInfo.project.name, scheme, "00-login");
    });
  }
});

for (const shot of SHOTS) {
  for (const scheme of ["dark", "light"] as const) {
    test(`${shot.slug} (${scheme})`, async ({ page }, testInfo) => {
      await setScheme(page, scheme);
      await page.goto(shot.url);
      await page.waitForLoadState("load");
      if (shot.ready) await shot.ready(page);
      if (shot.setup) await shot.setup(page);
      await page.waitForTimeout(500);
      await save(page, testInfo.project.name, scheme, shot.slug, shot.element);
    });
  }
}

/**
 * Pins the colour scheme the way the app itself does — writing the stored mode
 * before any script runs, so the pre-hydration theme script picks it up and the
 * page paints in the right scheme from the first frame. Toggling afterwards
 * would capture a transition.
 */
async function setScheme(page: Page, scheme: "dark" | "light") {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("zw:theme-mode", value);
    } catch {
      // storage disabled — the script's own fallback applies
    }
  }, scheme);
}

/**
 * Full-page capture, clipped to a height a browser will actually render.
 *
 * WebKit refuses any dimension over 32767px, and the log-history page in a
 * long-lived E2E database goes past that. Clipping keeps the top of the page —
 * which is what a design review looks at — instead of failing outright.
 */
const MAX_SHOT_HEIGHT = 20_000;

async function save(page: Page, project: string, scheme: string, slug: string, element?: string) {
  const dir = path.join(OUT, `${project}-${scheme}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.png`);

  if (element) {
    const target = page.getByTestId(element);
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await target.screenshot({ path: file });
    return;
  }

  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight,
  }));

  if (height <= MAX_SHOT_HEIGHT) {
    await page.screenshot({ path: file, fullPage: true });
    return;
  }
  // Worth knowing about rather than silently clipping: a page this tall is
  // usually a list that should be windowed and isn't.
  console.log(`  [shots] ${slug} (${scheme}) is ${height}px tall — clipped`);
  await page.screenshot({
    path: file,
    clip: { x: 0, y: 0, width, height: MAX_SHOT_HEIGHT },
  });
}
