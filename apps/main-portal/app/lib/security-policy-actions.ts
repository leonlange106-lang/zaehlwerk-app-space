"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@zaehlwerk/database";
import { requireAdmin } from "./auth-helpers";
import { AUDIT_ACTIONS, recordAuditEvent } from "./audit";
import { getEnforceTwoFactor, setEnforceTwoFactor } from "./settings";

// Admin-only instance security policy. This is a "use server" module, so every
// export is a POST endpoint reachable by anyone who can guess it — `requireAdmin`
// at the top of each is the actual guard, not the fact that the UI is hidden.

export interface EnforceTwoFactorResult {
  success: boolean;
  enforced: boolean;
  error?: string;
  /** How many accounts are now locked out until they enrol. */
  affectedUsers?: number;
}

export async function setEnforceTwoFactorAction(
  enforced: boolean,
): Promise<EnforceTwoFactorResult> {
  try {
    const admin = await requireAdmin();
    await setEnforceTwoFactor(enforced);

    // Worth counting and reporting: switching this on locks every account
    // without a second factor out of the app until it enrols, and an operator
    // deserves to learn that from the confirmation rather than from a colleague.
    const affectedUsers = enforced
      ? await prisma.user.count({ where: { twoFactorEnabled: false, mustSetPassword: false } })
      : 0;

    await recordAuditEvent(
      AUDIT_ACTIONS.securityPolicy,
      admin.email,
      enforced
        ? `2FA-Pflicht aktiviert · ${affectedUsers} Konto(en) ohne zweiten Faktor betroffen`
        : "2FA-Pflicht aufgehoben",
    );
    revalidatePath("/settings");
    return { success: true, enforced, affectedUsers };
  } catch (error) {
    return {
      success: false,
      // Report what is actually stored, so a failed toggle snaps back instead of
      // leaving the switch showing a policy that was never saved.
      enforced: await getEnforceTwoFactor().catch(() => false),
      error: error instanceof Error ? error.message : "Einstellung konnte nicht gespeichert werden.",
    };
  }
}
