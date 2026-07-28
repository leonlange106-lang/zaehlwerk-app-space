import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Dedicated E2E DB + port so a running `pnpm dev` never collides with the suite.
const PORT = 3100;
const DB_PATH = path.join(__dirname, "e2e", ".data", "e2e.db").replace(/\\/g, "/");
const DATABASE_URL = `file:${DB_PATH}`;

export default defineConfig({
  testDir: "./e2e",
  // The screenshot sweep lives in the same folder but is not a regression test —
  // it asserts nothing and only exists to produce review images. It runs under
  // its own config (`playwright test -c e2e/shots.config.ts`), which adds the
  // desktop viewport and the light/dark pass this suite has no use for.
  // `smoke.spec.ts` runs under e2e/smoke.config.ts against a PRODUCTION build;
  // running it here would start it against `next dev` and quietly defeat its
  // entire purpose.
  testIgnore: [/shots\.spec\.ts/, /smoke\.spec\.ts/],
  globalSetup: "./e2e/global-setup.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e/.report" }],
  ],
  outputDir: "e2e/.test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      // Mobile Chrome — Pixel 5 (393px). Covers Android/Chromium mobile.
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"], storageState: "e2e/.auth/state.json" },
      dependencies: ["setup"],
    },
    {
      // Mobile Safari — iPhone 14 (390px). Covers iOS/WebKit mobile.
      name: "Mobile Safari",
      use: { ...devices["iPhone 14"], storageState: "e2e/.auth/state.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    // Probe the DB-free health route: readiness must not depend on the E2E DB,
    // which globalSetup only creates AFTER the server is up.
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL,
      AUTH_SECRET: "e2e-secret-do-not-use-in-production-0123456789",
      AUTH_TRUST_HOST: "true",
      // Das ADRESS-Limit der Anmeldebremse hochgesetzt — und nur dieses.
      //
      // Die Suite meldet sich in wenigen Minuten hundertfach an, alles von einer
      // Adresse. Der Vorgabewert (60 je Viertelstunde) ist fuer einen Haushalt
      // gedacht, nicht fuer das hier; mit ihm bricht die Suite mitten im Lauf ab,
      // und zwar mit Zeitueberschreitungen beim Anmelden, die wie ein Fehler in
      // der Oberflaeche aussehen.
      //
      // Die KONTO-Limits bleiben absichtlich auf ihren Vorgabewerten: Sie sind
      // die eigentliche Schranke gegen Passwortraten, und die soll die Suite
      // durchlaufen wie eine echte Installation.
      LOGIN_RATE_LIMIT_PER_IP: "100000",
      TOTP_RATE_LIMIT_PER_IP: "100000",
    },
  },
});
