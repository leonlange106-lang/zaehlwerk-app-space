"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { prisma } from "@zaehlwerk/database";
import type { ActionState } from "./action-state";
import { getSessionUser } from "./auth-helpers";
import { decryptSecret, encryptSecret } from "./crypto";
import { getEnforceTwoFactor } from "./settings";
import { generateTotpSecret, otpauthUri, totpDriftSeconds, verifyTotp } from "./totp";

export type TwoFactorSetup = {
  secret: string;
  qrDataUrl: string;
  /** Account name shown next to the key, for password managers that ask. */
  account: string;
  /** True when this is a key that was already handed out earlier. */
  resumed: boolean;
  /**
   * The server's own clock, ISO. Shown in the UI because TOTP fails silently and
   * completely when the two clocks disagree, and a drifted container host is the
   * common cause — visible up front, it is a five-second diagnosis instead of a
   * loop of re-scanning.
   */
  serverTime: string;
};

/**
 * Begin (or RESUME) 2FA enrollment.
 *
 * Resuming is the whole point. This used to mint a fresh secret on every call
 * and overwrite the stored one, which broke the most ordinary mobile flow there
 * is: copy the key, switch to the password manager, save it, come back to a
 * reloaded page, press "set up" again — and the key the manager just saved is
 * now the OLD one while the database holds a new one. Every code then fails, and
 * nothing on screen explains why. So a pending secret is reused until enrollment
 * actually completes.
 *
 * Enrollment completes only once confirmTwoFactor() verifies a live code; until
 * then the row keeps twoFactorEnabled=false.
 */
export async function startTwoFactorSetup(): Promise<
  { success: true; setup: TwoFactorSetup } | { success: false; error: string }
> {
  const user = await getSessionUser();
  if (!user) return { success: false, error: "Nicht angemeldet." };

  try {
    const record = await prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });

    // Refuse while 2FA is ACTIVE. Without this, calling this action was a way to
    // switch someone's second factor off and replace it with your own without
    // ever proving you hold the current one — disableTwoFactor demands a valid
    // code precisely so that cannot happen, and this path went around it. Server
    // actions are POST endpoints reachable by anyone with the session, so "the
    // UI does not offer it" is not a control.
    if (record?.twoFactorEnabled) {
      return {
        success: false,
        error: "2FA ist bereits aktiv. Zum Wechseln zuerst deaktivieren.",
      };
    }

    // Reuse the pending key if there is a readable one.
    let secret: string | null = null;
    if (record?.twoFactorSecret) {
      try {
        secret = decryptSecret(record.twoFactorSecret);
      } catch {
        // Unreadable (key rotated, row corrupted) — fall through and mint a new
        // one. Nothing depends on it yet, since enrollment never completed.
        secret = null;
      }
    }

    const resumed = secret !== null;
    if (!secret) {
      secret = generateTotpSecret();
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabled: false },
      });
    }

    const qrDataUrl = await QRCode.toDataURL(otpauthUri(secret, user.email), {
      margin: 1,
      width: 220,
    });
    return {
      success: true,
      setup: {
        secret,
        qrDataUrl,
        account: user.email,
        resumed,
        serverTime: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error("[startTwoFactorSetup]", error);
    return { success: false, error: "2FA-Einrichtung konnte nicht gestartet werden." };
  }
}

/**
 * Throw away a pending (unconfirmed) key and issue a new one.
 *
 * The escape hatch for the case resuming cannot fix: the key was saved somewhere
 * unreachable, or half-transferred, and the user wants to start clean. Refuses
 * while 2FA is active, for the same reason startTwoFactorSetup does.
 */
export async function regenerateTwoFactorSecret(): Promise<
  { success: true; setup: TwoFactorSetup } | { success: false; error: string }
> {
  const user = await getSessionUser();
  if (!user) return { success: false, error: "Nicht angemeldet." };

  try {
    const record = await prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true },
    });
    if (record?.twoFactorEnabled) {
      return { success: false, error: "2FA ist bereits aktiv. Zum Wechseln zuerst deaktivieren." };
    }

    const secret = generateTotpSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabled: false },
    });
    const qrDataUrl = await QRCode.toDataURL(otpauthUri(secret, user.email), {
      margin: 1,
      width: 220,
    });
    return {
      success: true,
      setup: {
        secret,
        qrDataUrl,
        account: user.email,
        resumed: false,
        serverTime: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error("[regenerateTwoFactorSecret]", error);
    return { success: false, error: "Neuer Schlüssel konnte nicht erzeugt werden." };
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
    // Look again with a wide window before blaming the user. If the code lands
    // at an offset, their authenticator is right and this server's clock is
    // wrong — every code will fail until the host's time is fixed, and no amount
    // of re-scanning will help. Saying so is the difference between a five-minute
    // fix and an afternoon.
    const drift = totpDriftSeconds(secret, code);
    if (drift !== null && drift !== 0) {
      const minutes = Math.round(Math.abs(drift) / 60);
      const amount = minutes >= 1 ? `${minutes} Minute(n)` : `${Math.abs(drift)} Sekunden`;
      const direction = drift > 0 ? "nach" : "vor";
      return {
        success: false,
        error:
          `Der Code stimmt, aber die Uhr dieses Servers geht ${amount} ${direction}. ` +
          `Serverzeit: ${new Date().toLocaleString("de-DE")}. ` +
          "Zeitsynchronisierung auf dem Host einrichten (NTP), danach klappt die Einrichtung sofort.",
      };
    }
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

  // While the instance requires a second factor, turning yours off is not a
  // choice you have. Without this the policy is advisory: disable, get shown the
  // enrolment gate, and the account is stuck in a loop it created itself.
  if (await getEnforceTwoFactor()) {
    return {
      success: false,
      error:
        "Diese Instanz verlangt Zwei-Faktor-Authentifizierung. Die Pflicht muss zuerst in den Plattform-Einstellungen aufgehoben werden.",
    };
  }

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
