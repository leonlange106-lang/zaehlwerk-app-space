import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Screenshot run — deliberately its OWN config, not a project inside
// playwright.config.ts: it needs desktop viewports and a light/dark sweep, and
// mixing that into the regression suite would double every spec's runtime for
// no coverage. Reuses the same port/database so the seeded admin session works.
const PORT = 3100;
const DB_PATH = path.join(__dirname, ".data", "e2e.db");

export default defineConfig({
  testDir: __dirname,
  testMatch: /shots\.spec\.ts/,
  outputDir: path.join(__dirname, ".shots-results"),
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    storageState: "e2e/.auth/state.json",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      DATABASE_URL: `file:${DB_PATH.replace(/\\/g, "/")}`,
      AUTH_SECRET: "e2e-secret-not-for-production",
      AUTH_TRUST_HOST: "true",
      NEXTAUTH_URL: `http://localhost:${PORT}`,
    },
  },
});
