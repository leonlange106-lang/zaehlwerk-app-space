import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { PrismaClient } from "@zaehlwerk/database";
import { E2E_ADMIN } from "./fixtures";

// Signing IN with 2FA on — the half of the flow no spec covered.
//
// Enrolment had its own end-to-end spec, and it passed while logging in was
// impossible: every code the authenticator produced came back "ungültig". The
// two paths verify the same secret with the same function, so the difference was
// never the code. It was the challenge cookie that carries "the password step
// passed" from /login to /login/2fa — set with `secure` hardcoded to
// NODE_ENV === "production", so on any instance not served over TLS the browser
// dropped it, the second factor had nothing to identify the user by, and the
// only thing left to say was that the code was wrong.
//
// So this spec drives the real flow: password, then a genuine TOTP code computed
// from the stored secret, and it requires an actual session at the end.

const E2E_DB = path.join(__dirname, ".data", "e2e.db").replace(/\\/g, "/");
const prisma = new PrismaClient({ datasourceUrl: `file:${E2E_DB}` });

// Must match playwright.config.ts — the stored secret is encrypted with a key
// derived from it, so a mismatch makes every code fail for the wrong reason.
process.env.AUTH_SECRET ??= "e2e-secret-do-not-use-in-production-0123456789";

// Imported lazily so the AUTH_SECRET above is in place before key() reads it.
async function encrypt(plain: string): Promise<string> {
  const { encryptSecret } = await import("../app/lib/crypto");
  return encryptSecret(plain);
}

const SECRET = new OTPAuth.Secret({ size: 20 }).base32;

function currentCode(): string {
  return new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(SECRET),
  }).generate();
}

async function enableTwoFactor() {
  await prisma.user.updateMany({
    where: { email: E2E_ADMIN.email },
    data: { twoFactorEnabled: true, twoFactorSecret: await encrypt(SECRET) },
  });
}

async function clearTwoFactor() {
  await prisma.user.updateMany({
    where: { email: E2E_ADMIN.email },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
}

/** The signed-in user, or null. Auth.js answers `null` (not `{}`) when there is
 *  no session, so compare against null rather than an empty object. */
async function sessionUser(page: Page): Promise<unknown> {
  const response = await page.request.get("/api/auth/session");
  const body = (await response.json()) as { user?: unknown } | null;
  return body?.user ?? null;
}

/**
 * Type a code into the per-digit inputs the way a person does.
 *
 * Each digit is re-filled until it sticks. WebKit drops a `fill()` issued
 * before React has hydrated the controlled input — after `page.reload()` the
 * first box is the one that loses it — and the result is a five-digit entry the
 * app then rightly refuses to submit, so the test hangs waiting for a
 * navigation that must not happen. Same lesson as `helpers.ts`, which types the
 * login fields and asserts they landed before pressing anything.
 *
 * The LAST digit is filled without verification on purpose: it completes the
 * code, which submits it, and the error path clears the field — so asserting
 * its value is a race against the app doing its job.
 */
async function typeCode(page: Page, code: string) {
  const digits = page.getByRole("textbox", { name: /Ziffer/ });
  for (let index = 0; index < code.length; index += 1) {
    const box = digits.nth(index);
    if (index === code.length - 1) {
      await box.fill(code[index]);
      return;
    }
    await expect(async () => {
      await box.fill(code[index]);
      await expect(box).toHaveValue(code[index], { timeout: 500 });
    }).toPass({ timeout: 5_000 });
  }
}

async function submitPassword(page: Page) {
  await page.goto("/login");
  const email = page.getByRole("textbox", { name: "E-Mail", exact: true });
  const password = page.getByRole("textbox", { name: "Passwort", exact: true });

  await email.click();
  await email.pressSequentially(E2E_ADMIN.email, { delay: 10 });
  await password.click();
  await password.pressSequentially(E2E_ADMIN.password, { delay: 10 });
  await page.getByRole("button", { name: "Anmelden" }).click();
}

test.describe("2FA login", () => {
  // Start signed OUT — the projects otherwise reuse the stored admin session and
  // there would be no login to test.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async () => {
    await enableTwoFactor();
  });

  test.afterAll(async () => {
    await clearTwoFactor();
    await prisma.$disconnect();
  });

  test("the password alone stops at the second factor", async ({ page }) => {
    await submitPassword(page);
    await page.waitForURL((url) => url.pathname === "/login/2fa", { timeout: 15_000 });

    // The password must NOT have issued a session on its own.
    expect(await sessionUser(page), "password alone must not sign anyone in").toBeNull();
  });

  test("a genuine code from the enrolled key signs in", async ({ page }) => {
    await submitPassword(page);
    await page.waitForURL((url) => url.pathname === "/login/2fa", { timeout: 15_000 });

    await typeCode(page, currentCode());

    // Typing the last digit auto-submits; landing on the launcher is the proof.
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
    await expect(page.getByText("Weitere Apps")).toBeVisible();
  });

  test("a wrong code is refused and no session is issued", async ({ page }) => {
    await submitPassword(page);
    await page.waitForURL((url) => url.pathname === "/login/2fa", { timeout: 15_000 });

    await typeCode(page, "000000");

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    expect(await sessionUser(page)).toBeNull();
  });

  test("reloading the code screen keeps the password step valid", async ({ page }) => {
    await submitPassword(page);
    await page.waitForURL((url) => url.pathname === "/login/2fa", { timeout: 15_000 });

    // A password manager round-trip reloads this page. The challenge must
    // survive it, or the code is rejected for a reason nothing on screen names.
    await page.reload();
    await typeCode(page, currentCode());

    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  });

  test("a missing challenge says the password step is gone, not that the code is wrong", async ({
    page,
  }) => {
    await submitPassword(page);
    await page.waitForURL((url) => url.pathname === "/login/2fa", { timeout: 15_000 });

    // Reproduce, from the browser side, what a `secure` cookie over plain HTTP
    // does: the challenge simply is not there. The old build blamed the code and
    // sent the user round the loop; a real code cannot fix this, so the message
    // must point at the password step instead.
    await page.context().clearCookies({ name: "zw_2fa_challenge" });
    await typeCode(page, currentCode());

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).not.toContainText("Code ist ungültig");
    expect(await sessionUser(page)).toBeNull();
  });

  test("entering the code out of order does not submit a short one", async ({ page }) => {
    await submitPassword(page);
    await page.waitForURL((url) => url.pathname === "/login/2fa", { timeout: 15_000 });

    const code = currentCode();
    const digits = page.getByRole("textbox", { name: /Ziffer/ });

    // Skip the first box, as happens when a later box is tapped directly. Five
    // digits land and box one stays empty — a value six CHARACTERS long holding
    // five digits. That used to auto-submit, come back "Code ist ungültig", and
    // clear the field, so repeating the same gesture failed the same way forever.
    for (let index = 1; index < 6; index += 1) {
      await digits.nth(index).fill(code[index]);
    }
    await expect(digits.nth(0)).toHaveValue("");

    // Nothing may have been sent, and the button must not offer to send it.
    // Matched on the message rather than role=alert: Next's route announcer is
    // itself an always-present role="alert", so counting the role proves nothing.
    await expect(page.getByText(/ungültig|abgelaufen|fehlgeschlagen/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bestätigen" })).toBeDisabled();
    expect(await sessionUser(page)).toBeNull();

    // Filling the gap completes the code — and it signs in, because the digits
    // were always right; only the gap made them look wrong.
    await digits.nth(0).fill(code[0]);
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  });

  test("the second-factor screen offers no app chrome", async ({ page }) => {
    await submitPassword(page);
    await page.waitForURL((url) => url.pathname === "/login/2fa", { timeout: 15_000 });

    // This screen used to draw the full shell: a navigation menu, a search field
    // and a notification bell for a visitor with no session — navigation offered
    // to someone who cannot use it, and a bell polling an API that turns it away.
    await expect(page.getByRole("button", { name: "Navigation öffnen" })).toHaveCount(0);
    await expect(page.getByTestId("notification-bell")).toHaveCount(0);
    await expect(page.getByTestId("global-search")).toHaveCount(0);
  });

  test("the challenge is spent once it has been accepted", async ({ page }) => {
    await submitPassword(page);
    await page.waitForURL((url) => url.pathname === "/login/2fa", { timeout: 15_000 });
    await typeCode(page, currentCode());
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });

    // The proof of the password step must not outlive its use — otherwise it
    // stays good for five minutes and any single valid code mints another session.
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === "zw_2fa_challenge")).toBeUndefined();
  });
});
