"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { prisma } from "@zaehlwerk/database";
import type { ActionState } from "./action-state";
import { getSessionUser } from "./auth-helpers";
import { decryptSecret, encryptSecret } from "./crypto";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

export type TwoFactorSetup = {
  secret: string;
  qrDataUrl: string;
};

/**
 * Begin 2FA enrollment: generate a fresh secret, store it ENCRYPTED but leave
 * twoFactorEnabled=false, and return the secret + QR code for the authenticator
 * app. Enrollment only completes once confirmTwoFactor() verifies a live code.
 */
export async function startTwoFactorSetup(): Promise<
  { success: true; setup: TwoFactorSetup } | { success: false; error: string }
> {
  const user = await getSessionUser();
  if (!user) return { success: false, error: "Nicht angemeldet." };

  const secret = generateTotpSecret();
  const uri = otpauthUri(secret, user.email);

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabled: false },
    });
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    return { success: true, setup: { secret, qrDataUrl } };
  } catch (error) {
    console.error("[startTwoFactorSetup]", error);
    return { success: false, error: "2FA-Einrichtung konnte nicht gestartet werden." };
  }
}

/** Finish enrollment by verifying a live code against the pending secret. */
export async function confirmTwoFactor(code: string): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { success: false, error: "Nicht angemeldet." };

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { twoFactorSecret: true },
  });
  if (!record?.twoFactorSecret) {
    return { success: false, error: "Keine 2FA-Einrichtung gefunden. Bitte erneut starten." };
  }

  let secret: string;
  try {
    secret = decryptSecret(record.twoFactorSecret);
  } catch {
    return { success: false, error: "Das Secret konnte nicht gelesen werden. Bitte erneut einrichten." };
  }

  if (!verifyTotp(secret, code)) {
    return { success: false, error: "Code ist ungültig. Bitte erneut versuchen." };
  }

  await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  revalidatePath("/settings");
  return { success: true };
}

/** Disable 2FA — requires a current valid code so a hijacked session alone
 *  can't turn it off. */
export async function disableTwoFactor(code: string): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { success: false, error: "Nicht angemeldet." };

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  });
  if (!record?.twoFactorEnabled || !record.twoFactorSecret) {
    return { success: false, error: "2FA ist nicht aktiv." };
  }

  try {
    if (!verifyTotp(decryptSecret(record.twoFactorSecret), code)) {
      return { success: false, error: "Code ist ungültig." };
    }
  } catch {
    return { success: false, error: "Das Secret konnte nicht gelesen werden." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
  revalidatePath("/settings");
  return { success: true };
}
