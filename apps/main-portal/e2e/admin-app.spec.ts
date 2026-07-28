import { test, expect } from "@playwright/test";
import { E2E_RESTRICTED } from "./fixtures";
import { login } from "./helpers";

// Die Admin-App: eigener Bereich statt eines Blocks auf der Startseite.
//
// Der interessante Teil ist nicht das Layout, sondern die Schranke. Dieser
// Bereich haengt an der ROLLE, nicht an einer App-Freigabe — eine gespeicherte
// Zuweisung darf ihn nicht oeffnen koennen.

test.describe("Admin-App", () => {
  test("die Übersicht führt in alle vier Bereiche", async ({ page }) => {
    await page.goto("/apps/admin");
    for (const slug of ["system", "traffic", "database", "activity"]) {
      await expect(page.getByTestId(`admin-section-${slug}`)).toBeVisible();
    }
  });

  test("ein Bereich lädt und führt zurück", async ({ page }) => {
    await page.goto("/apps/admin");
    await page.getByTestId("admin-section-database").click();
    await expect(page).toHaveURL(/\/apps\/admin\/database$/);
    await expect(page.getByRole("heading", { name: "Datenbank" }).first()).toBeVisible();

    await page.getByRole("link", { name: "Administration" }).first().click();
    await expect(page).toHaveURL(/\/apps\/admin$/);
  });

  test("Verkehr sagt, dass er nicht eingerichtet ist, statt leer zu bleiben", async ({ page }) => {
    // Ohne Cloudflare-Token ist das der Normalfall — und eine leere Seite waere
    // nicht von "keine Zugriffe" zu unterscheiden.
    await page.goto("/apps/admin/traffic");
    await expect(page.getByText("Noch nicht eingerichtet")).toBeVisible();
  });

  test("ein unbekannter Bereich ist ein 404", async ({ page }) => {
    expect((await page.request.get("/apps/admin/gibtsnicht")).status()).toBe(404);
  });

  test("der Admin-Block ist von der Startseite verschwunden", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("clear-cache")).toHaveCount(0);
  });
});

test.describe("Admin-App hängt an der Rolle", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("ein Nicht-Admin wird weggeleitet", async ({ page }) => {
    await login(page, E2E_RESTRICTED);
    await page.goto("/apps/admin");
    await expect(page).toHaveURL(/\/$/);
  });

  test("und findet den Bereich auch nicht über die Suche", async ({ page }) => {
    // Ein Treffer wuerde verraten, dass es ihn gibt.
    await login(page, E2E_RESTRICTED);
    const response = await page.request.get("/api/search?q=Administration");
    const { hits } = (await response.json()) as { hits: { href: string }[] };
    expect(hits.filter((hit) => hit.href.startsWith("/apps/admin"))).toEqual([]);
  });
});
