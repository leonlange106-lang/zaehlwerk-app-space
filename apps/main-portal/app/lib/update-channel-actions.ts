"use server";

import { revalidatePath } from "next/cache";
import { toReleaseChannel, type ReleaseChannel } from "@zaehlwerk/updater";
import { requireAdmin } from "./auth-helpers";
import { AUDIT_ACTIONS, recordAuditEvent } from "./audit";
import { getUpdateChannel, setUpdateChannel } from "./settings";

// Switching the release channel decides which code this instance will run next,
// so it is admin-only — `requireAdmin` throws for anyone else, and this file is
// a "use server" module, meaning every export here is a POST endpoint reachable
// by any logged-in user without it.

export async function setUpdateChannelAction(
  value: string,
): Promise<{ success: boolean; channel: ReleaseChannel; error?: string }> {
  try {
    const user = await requireAdmin();
    const channel = toReleaseChannel(value);
    await setUpdateChannel(channel);
    await recordAuditEvent(
      AUDIT_ACTIONS.systemUpdate,
      user.email,
      `Release-Channel auf "${channel}" gestellt`,
    );
    revalidatePath("/settings");
    return { success: true, channel };
  } catch (error) {
    return {
      success: false,
      channel: await getUpdateChannel(),
      error: error instanceof Error ? error.message : "Channel konnte nicht gespeichert werden.",
    };
  }
}
