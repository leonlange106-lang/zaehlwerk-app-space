import { test, expect } from "@playwright/test";
import { E2E_METER_NAME, E2E_RESTRICTED } from "./fixtures";
import { login } from "./helpers";

// Paket E: the header search and the settings groups.
//
// Both are navigation, and both are new surfaces where the interesting failure
// is not "it looks wrong" but "it shows someone something they may not see".
// The restricted account below has NO apps assigned, which is the case that
// turns a search result into an information leak: a hit names a meter or a log
// that account is not allowed to know exists.

test.describe("Global search", () => {
  test("the field is present on a phone and finds a settings group", async ({ page }) => {
    await page.goto("/");

    // Below `sm` the field starts as an icon — the old decorative input was
    // `hidden sm:block`, so the phone had no search at all.
    await page.getByRole("button", { name: "Suchen" }).click();
    const field = page.getByTestId("global-search");
    await expect(field).toBeVisible();

    await field.fill("Backup");
    const results = page.getByTestId("search-results");
    await expect(results).toBeVisible();

    // "Backup" is not in the group's TITLE — it is one of its topics. Finding it
    // anyway is the whole reason topics sit next to the route.
    const hit = results.getByRole("option", { name: /Daten & Backup/ });
    await expect(hit).toBeVisible();
    await hit.click();
    await expect(page).toHaveURL(/\/settings\/daten$/);
  });

  test("the expanded field is usably wide and does not push the page sideways", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Suchen" }).click();

    const field = page.getByTestId("global-search");
    const box = await field.boundingBox();
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    // Sharing the header's flex row left it about 100px on a 390px screen — the
    // menu, the brand and three round buttons are all flex-none and take theirs
    // first. Expanded it lies over the header instead.
    expect(box!.width, `field is only ${box!.width}px of ${clientWidth}px`).toBeGreaterThan(
      clientWidth * 0.6,
    );

    await field.fill("Backup");
    await expect(page.getByTestId("search-results")).toBeVisible();

    // Measured against clientWidth, never innerWidth: on overflow Chrome widens
    // the layout viewport and innerWidth grows with it, so the check would pass
    // while the page really did scroll sideways.
    const { scrollWidth, client } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `sw ${scrollWidth} vs client ${client}`).toBeLessThanOrEqual(client + 1);
  });

  test("Enter opens the highlighted result", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Suchen" }).click();
    const field = page.getByTestId("global-search");
    await field.fill("Prüfstand");
    // Wait for a RESULT, not for the panel: the panel opens as soon as the query
    // is long enough to run, i.e. before the request has come back, and Enter at
    // that moment has nothing to open.
    await expect(
      page.getByTestId("search-results").getByRole("option", { name: /Prüfstand/ }),
    ).toBeVisible();

    // A search only usable with a mouse locks the keyboard user out.
    await field.press("Enter");
    await expect(page).toHaveURL(/\/apps\/log-analyzer\/dyno$/);
  });

  test("finds a real meter from the database, not just a page", async ({ page }) => {
    // The other cases all resolve against the static target list. This one goes
    // through Prisma, which is the half of the search that can silently return
    // rows the ranker then discards.
    await page.goto("/");
    const response = await page.request.get(
      `/api/search?q=${encodeURIComponent(E2E_METER_NAME.slice(0, 8))}`,
    );
    const { hits } = (await response.json()) as { hits: { kind: string; title: string }[] };
    const meter = hits.find((hit) => hit.kind === "meter");
    expect(meter?.title, `expected the seeded meter, got ${JSON.stringify(hits)}`).toBe(
      E2E_METER_NAME,
    );
  });

  test("a lowercase umlaut still finds a capitalised one", async ({ page }) => {
    // SQLite's LIKE folds ASCII only, so "zähler" would not match "Zähler"
    // without the explicit case variants — the common case in a German UI.
    await page.goto("/");
    const response = await page.request.get("/api/search?q=z%C3%A4hler");
    const { hits } = (await response.json()) as { hits: { title: string }[] };
    expect(hits.length, "a lowercase umlaut must still match").toBeGreaterThan(0);
  });

  test("a query with no match says so instead of showing an empty box", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Suchen" }).click();
    await page.getByTestId("global-search").fill("qqqzzzxyz");
    await expect(page.getByTestId("search-results")).toContainText("Nichts gefunden");
  });

  test("Escape closes the results", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Suchen" }).click();
    const field = page.getByTestId("global-search");
    await field.fill("Backup");
    await expect(page.getByTestId("search-results")).toBeVisible();
    await field.press("Escape");
    await expect(page.getByTestId("search-results")).toHaveCount(0);
  });
});

test.describe("Global search respects app access", () => {
  // A fresh context: this account is not the seeded admin the other specs use.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an account without app access gets no hits from those apps", async ({ page }) => {
    await login(page, E2E_RESTRICTED);

    // The API is the authority — the UI filter is not the control, and asking it
    // directly is what proves the route itself refuses.
    for (const term of ["Zähler", "Prüfstand", "Log"]) {
      const response = await page.request.get(`/api/search?q=${encodeURIComponent(term)}`);
      expect(response.ok()).toBe(true);
      const { hits } = (await response.json()) as { hits: { href: string; title: string }[] };
      const leaked = hits.filter((hit) => hit.href.startsWith("/apps/"));
      expect(leaked, `"${term}" leaked ${leaked.map((h) => h.title).join(", ")}`).toEqual([]);
    }
  });

  test("an admin-only settings group is not offered to a normal user", async ({ page }) => {
    await login(page, E2E_RESTRICTED);
    const response = await page.request.get("/api/search?q=Benutzer");
    const { hits } = (await response.json()) as { hits: { href: string }[] };
    expect(hits.map((hit) => hit.href)).not.toContain("/settings/benutzer");
  });

  test("the admin-only group 404s when typed directly", async ({ page }) => {
    await login(page, E2E_RESTRICTED);
    // Hiding the tile is convenience; the route is the control.
    const response = await page.request.get("/settings/benutzer");
    expect(response.status()).toBe(404);
  });
});

test.describe("Settings groups", () => {
  test("the index offers the groups instead of every card at once", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Plattform-Einstellungen" })).toBeVisible();

    for (const slug of ["sicherheit", "benutzer", "integrationen", "daten", "system"]) {
      await expect(page.getByTestId(`settings-group-${slug}`)).toBeVisible();
    }

    // The cards themselves must NOT be here any more — that stack measured
    // 13 629 px tall on a phone.
    await expect(page.getByTestId("version-history")).toHaveCount(0);
    await expect(page.getByTestId("enforce-2fa")).toHaveCount(0);
  });

  test("a group page shows its cards and leads back", async ({ page }) => {
    await page.goto("/settings");
    await page.getByTestId("settings-group-sicherheit").click();

    await expect(page).toHaveURL(/\/settings\/sicherheit$/);
    await expect(page.getByRole("heading", { name: "Sicherheit & Zugriff" })).toBeVisible();
    await expect(page.getByTestId("enforce-2fa")).toBeVisible();

    await page.getByRole("link", { name: "Plattform-Einstellungen" }).first().click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("the index is a fraction of the height the single page was", async ({ page }) => {
    await page.goto("/settings");
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    // The old page measured 13 629 px on this viewport. An index of tiles has no
    // business being anywhere near that; 2000 px is a generous ceiling that still
    // fails loudly if the cards ever creep back onto this route.
    expect(height, `settings index is ${height}px tall`).toBeLessThan(2000);
  });

  test("an unknown group is a 404, not an empty page", async ({ page }) => {
    const response = await page.request.get("/settings/gibtsnicht");
    expect(response.status()).toBe(404);
  });

  test("the navigation menu carries the groups as its own level", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Navigation öffnen" }).click();
    await page.getByRole("menuitem", { name: "Plattform-Einstellungen" }).click();

    // Drilled in, not navigated — the menu stays open on its settings level.
    await expect(page.getByRole("menuitem", { name: "Alle Bereiche" })).toBeVisible();
    await page.getByRole("menuitem", { name: "System & Update" }).click();
    await expect(page).toHaveURL(/\/settings\/system$/);
  });
});

test.describe("Sign out", () => {
  test("lands on /login on the SAME origin", async ({ page }) => {
    // Regression: signing out sent people to http://0.0.0.0:3000/login — an
    // address no browser can reach. `signOut({ callbackUrl })` makes the server
    // resolve that path against its own base URL, and the container sets
    // HOSTNAME=0.0.0.0 for Next's standalone bind address.
    await page.goto("/");
    const origin = new URL(page.url()).origin;

    await page.getByRole("button", { name: "Benutzermenü" }).click();
    await page.getByRole("menuitem", { name: "Abmelden" }).click();

    await page.waitForURL((url) => url.pathname === "/login", { timeout: 15_000 });
    // The origin is the assertion — a wrong host is exactly what broke, and a
    // pathname check alone would have passed straight through it.
    expect(new URL(page.url()).origin, "sign-out must not change the origin").toBe(origin);
  });
});
