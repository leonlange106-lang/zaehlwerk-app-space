import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";

/**
 * Die Routen einmal anfassen, bevor der erste Test sie braucht.
 *
 * `next dev` uebersetzt eine Route beim ERSTEN Aufruf. Auf einem ausgelasteten
 * Runner dauert das zweistellige Sekunden — laenger als jede vernuenftige
 * Wartezeit im Test. Getroffen hat es dann genau den ersten Test, der die Route
 * betritt, waehrend alle spaeteren in zwei bis fuenf Sekunden durch waren: Das
 * sieht aus wie ein Fehler in der Anmeldung und ist einer im Aufbau.
 *
 * Fehler werden hier bewusst verschluckt. Das Vorwaermen ist eine
 * Beschleunigung, keine Zusicherung — schlaegt es fehl, laeuft die Suite wie
 * bisher, nur wieder mit dem kalten ersten Aufruf.
 */
async function warmRoutes(baseURL: string): Promise<void> {
  for (const route of ["/", "/login", "/login/2fa", "/api/health"]) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      await fetch(new URL(route, baseURL), { signal: controller.signal });
      clearTimeout(timer);
    } catch {
      // siehe oben — nie den Lauf daran scheitern lassen
    }
  }
}

// Prepares the dedicated E2E database before the suite: creates the schema
// (prisma db push) and seeds a known admin + meter fixture. Runs once per
// `playwright test` invocation, so `pnpm test:e2e` is fully self-contained.
//
// This runs AFTER the dev server is already up (see the health-probe note in
// playwright.config.ts), so the reset must happen through the seed's DELETEs —
// replacing the .db FILE here would pull the database out from under the
// server's open connection and every request would fail.
export default async function globalSetup(config: FullConfig) {
  const e2eDir = __dirname;
  const mainPortalDir = path.join(e2eDir, "..");
  const schema = path.join(mainPortalDir, "..", "..", "packages", "database", "prisma", "schema.prisma");
  const dbPath = path.join(e2eDir, ".data", "e2e.db").replace(/\\/g, "/");

  fs.mkdirSync(path.join(e2eDir, ".data"), { recursive: true });

  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    AUTH_SECRET: "e2e-secret-do-not-use-in-production-0123456789",
  };

  execSync(
    `pnpm --filter @zaehlwerk/database exec prisma db push --schema "${schema}" --skip-generate --accept-data-loss`,
    { env, stdio: "inherit" },
  );
  execSync(`pnpm exec tsx "${path.join(e2eDir, "seed.ts")}"`, {
    env,
    stdio: "inherit",
    cwd: mainPortalDir,
  });

  // Nach dem Seed, damit die vorgewaermten Routen bereits echte Daten sehen.
  const baseURL = config.projects.map((project) => project.use.baseURL).find(Boolean);
  if (baseURL) await warmRoutes(baseURL);
}
