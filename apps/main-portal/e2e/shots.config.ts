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
      // MUST match playwright.config.ts: that config's server minted the session
      // in e2e/.auth/state.json, and Auth.js rejects a cookie signed with a
      // different secret. A mismatch here only stayed invisible because
      // `reuseExistingServer` usually hands this run the regression suite's
      // server — start it on its own and every shot lands on /login instead.
      AUTH_SECRET: "e2e-secret-do-not-use-in-production-0123456789",
      AUTH_TRUST_HOST: "true",
      NEXTAUTH_URL: `http://localhost:${PORT}`,
      // The rollback card reads the deploy history off the /data volume, which
      // does not exist outside the container. Point it at a fixture so the card
      // has rows to show instead of its empty state.
      DEPLOY_HISTORY_FILE: path.join(__dirname, ".data", "deploy-history.jsonl"),
      // Passed through, never hardcoded: the repo is private, so without a token
      // the release half of the version list is simply unavailable and the card
      // shows its degraded state. `GITHUB_TOKEN=$(gh auth token)` before the run.
      GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "",
    },
  },
});
