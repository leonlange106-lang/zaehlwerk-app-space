import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { PrismaClient } from "@zaehlwerk/database";

// Enrolling 2FA for real: read the key the app hands out, compute a genuine
// code from it, type it in, and require that the account ends up protected.
//
// This is the test that was missing. Enrolment was impossible for a while and
// every existing test still passed, because they all stopped at "the dialog
// shows a key". The failure lived one step further on: PinInput passes the
// finished value to `onComplete`, the caller ignored it and read component
// state, and at that instant the state still held five digits — so typing the
// sixth digit submitted a five-digit code, was rejected, and the error path
// cleared the field. Nothing on screen suggested why.
//
// Cleanup is mandatory, not tidiness: leaving the seeded admin with 2FA active
// would make every later sign-in demand a code the other specs cannot produce.

const E2E_DB = path.join(__dirname, ".data", "e2e.db").replace(/\\/g, "/");
const prisma = new PrismaClient({ datasourceUrl: `file:${E2E_DB}` });

async function clearTwoFactor() {
  await prisma.user.updateMany({
    where: { email: "admin@e2e.test" },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
}

/** Type a code into the per-digit inputs the way a person does. */
async function typeCode(page: Page, code: string) {
  const digits = page.getByRole("textbox", { name: /Ziffer/ });
  for (let index = 0; index < code.length; index += 1) {
    await digits.nth(index).fill(code[index]);
  }
}

test.describe("2FA enrolment, end to end", () => {
  test.beforeEach(async () => {
    await clearTwoFactor();
  });

  test.afterAll(async () => {
    await clearTwoFactor();
    await prisma.$disconnect();
  });

  test("a valid code from the offered key activates 2FA", async ({ page }) => {
    await page.goto("/settings/sicherheit");
    await page.getByRole("button", { name: "2FA einrichten" }).click();

    const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
    expect(secret, "the enrolment key must be shown").toMatch(/^[A-Z2-7]{16,}$/);

    // Exactly what an authenticator app would produce from that key.
    const code = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    }).generate();

    await typeCode(page, code);

    // Typing the last digit auto-submits. It must succeed on that alone — the
    // regression was that this path submitted an incomplete code.
    await expect(page.getByText("2FA aktiviert")).toBeVisible({ timeout: 15_000 });

    const stored = await prisma.user.findUnique({
      where: { email: "admin@e2e.test" },
      select: { twoFactorEnabled: true },
    });
    expect(stored?.twoFactorEnabled, "2FA must actually be on in the database").toBe(true);
  });

  test("a wrong code is rejected and says so", async ({ page }) => {
    await page.goto("/settings/sicherheit");
    await page.getByRole("button", { name: "2FA einrichten" }).click();
    await expect(page.getByTestId("totp-secret")).toBeVisible();

    await typeCode(page, "000000");

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    const stored = await prisma.user.findUnique({
      where: { email: "admin@e2e.test" },
      select: { twoFactorEnabled: true },
    });
    expect(stored?.twoFactorEnabled).toBe(false);
  });
});
