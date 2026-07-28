import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The app as it actually runs: a PRODUCTION build behind `next start`.
//
// This config exists because the regression suite cannot see a whole class of
// bug. `playwright.config.ts` spawns `next dev`, so anything gated on
// `NODE_ENV === "production"` — or on the environment the container sets — is
// invisible to all 200-odd tests in it. Two failures this year proved the point,
// and both reached users:
//
//   * The 2FA challenge cookie carried `secure` derived from NODE_ENV. In
//     production over plain HTTP the browser discarded it without a word, and
//     every code came back "ungültig". Under `next dev` the flag was never set,
//     so the suite was green throughout.
//   * Signing out sent people to `http://0.0.0.0:3000/login`, because the
//     container sets HOSTNAME=0.0.0.0 as Next's standalone bind address and
//     Auth.js built its redirect from it. No dev run has that variable.
//
// So this runs the real build, over plain HTTP (as an unproxied instance is
// reached), with HOSTNAME set exactly as the Dockerfile sets it. Both bugs
// reproduce here — that is the whole point of the file.

const PORT = 3200;
const DB_PATH = path.join(__dirname, ".data", "smoke.db").replace(/\\/g, "/");

/**
 * A NON-LOOPBACK address for the browser to connect to.
 *
 * Load-bearing, not tidiness. Browsers treat `http://localhost` and `127.0.0.1`
 * as "potentially trustworthy origins" and accept `Secure` cookies there — so
 * over localhost the very bug this file exists to catch *cannot happen*.
 *
 * Learned the hard way: with the cookie fix deliberately reverted, this suite
 * stayed green until the address changed. A smoke test that cannot fail for the
 * reason it was written is worse than none, because it is believed.
 *
 * The server already binds 0.0.0.0 (HOSTNAME below), so reaching it by the
 * machine's own address works locally and on a CI runner alike.
 */
function nonLoopbackHost(): string {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  // No such interface. Falling back keeps the run alive, but the cookie check is
  // toothless — so say so loudly rather than pass quietly.
  console.warn(
    "[smoke] no non-loopback IPv4 found; falling back to localhost. " +
      "Secure-cookie behaviour will NOT be exercised.",
  );
  return "localhost";
}

const HOST = process.env.SMOKE_HOST ?? nonLoopbackHost();

export default defineConfig({
  testDir: ".",
  testMatch: /smoke\.spec\.ts/,
  globalSetup: "./smoke-setup.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  outputDir: ".test-results-smoke",
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "production", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `next start`, not `next dev` — NODE_ENV=production comes from it.
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://${HOST}:${PORT}/api/health`,
    // Never reuse: a dev server on another port would silently pass the probe
    // and the whole point of this config would be lost.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: `file:${DB_PATH}`,
      AUTH_SECRET: "smoke-secret-do-not-use-in-production-0123456789",
      AUTH_TRUST_HOST: "true",
      // Mirrors `ENV HOSTNAME=0.0.0.0` in the Dockerfile. It is what made
      // sign-out redirect to an unreachable address, so the test must run with
      // it or it is not testing the deployment.
      HOSTNAME: "0.0.0.0",
    },
  },
});
