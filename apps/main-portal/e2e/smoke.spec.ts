import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { PrismaClient } from "@zaehlwerk/database";
import { E2E_ADMIN } from "./fixtures";
import { encryptSecret } from "./encrypt-secret";

// The short list of things that must work in the REAL build, over plain HTTP,
// with the container's environment. Deliberately small: this runs after a full
// production build, so every test here costs minutes, and its job is to catch
// the class of failure `next dev` hides — not to re-test the product.

const SMOKE_DB = path.join(__dirname, ".data", "smoke.db").replace(/\\/g, "/");
const prisma = new PrismaClient({ datasourceUrl: `file:${SMOKE_DB}` });

const AUTH_SECRET = "smoke-secret-do-not-use-in-production-0123456789";

const SECRET = new OTPAuth.Secret({ size: 20 }).base32;
const code = () =>
  new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(SECRET),
  }).generate();

async function password(page: Page) {
  await page.goto("/login");
  const email = page.getByRole("textbox", { name: "E-Mail", exact: true });
  const pass = page.getByRole("textbox", { name: "Passwort", exact: true });
  await email.click();
  await email.pressSequentially(E2E_ADMIN.email, { delay: 10 });
  await pass.click();
  await pass.pressSequentially(E2E_ADMIN.password, { delay: 10 });
  await page.getByRole("button", { name: "Anmelden" }).click();
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("the production build serves the app and signs a user in", async ({ page }) => {
  await password(page);
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  await expect(page.getByText("Weitere Apps")).toBeVisible();
});

test("2FA login works in production over plain HTTP", async ({ page }) => {
  // THE test this file exists for. The challenge cookie used to carry `secure`
  // derived from NODE_ENV; here NODE_ENV really is production and the
  // connection really is HTTP, so the browser really does discard it — and the
  // second factor fails exactly as it did for users. Under `next dev` this
  // passes no matter what, which is why 200 other tests never saw it.
  await prisma.user.updateMany({
    where: { email: E2E_ADMIN.email },
    data: { twoFactorEnabled: true, twoFactorSecret: encryptSecret(SECRET, AUTH_SECRET) },
  });

  try {
    await password(page);
    await page.waitForURL((url) => url.pathname === "/login/2fa", { timeout: 30_000 });

    const digits = page.getByRole("textbox", { name: /Ziffer/ });
    const value = code();
    for (let i = 0; i < 6; i += 1) await digits.nth(i).fill(value[i]);

    await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  } finally {
    await prisma.user.updateMany({
      where: { email: E2E_ADMIN.email },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
  }
});

test("signing out stays on the same origin", async ({ page }) => {
  // The other production-only failure: HOSTNAME=0.0.0.0 (set here exactly as
  // the Dockerfile sets it) leaked into the redirect Auth.js built, and users
  // landed on an address no browser can reach.
  await password(page);
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  const origin = new URL(page.url()).origin;

  await page.getByRole("button", { name: "Benutzermenü" }).click();
  await page.getByRole("menuitem", { name: "Abmelden" }).click();

  await page.waitForURL((url) => url.pathname === "/login", { timeout: 30_000 });
  expect(new URL(page.url()).origin, "sign-out must not change the origin").toBe(origin);
});
