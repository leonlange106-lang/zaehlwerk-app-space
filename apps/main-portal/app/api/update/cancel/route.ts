import { type NextRequest, NextResponse } from "next/server";
import { denyUnlessAdmin, sessionUserForAudit } from "@/app/lib/api-guards";
import { AUDIT_ACTIONS, recordAuditEvent } from "@/app/lib/audit";
import { readUpdateState } from "@/app/lib/update-state";
import { isCancellable } from "@/app/lib/update-status";
import { cancelDeployRun, updateTokenAccepted, writeCancelledStatus } from "@/app/lib/update-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stop a running update or rollback.
 *
 * Only up to and including the migration. Until then the OLD container is still
 * serving and nothing has been swapped, so aborting costs a wasted build and
 * nothing else. From `restarting` on, the detached deployer is recreating
 * containers — killing it there would leave the stack half-swapped, which is the
 * exact failure the detached-deployer design exists to prevent. So this refuses
 * rather than offering a stop that breaks the site.
 */
export async function POST(request: NextRequest) {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  if (!updateTokenAccepted(request.headers.get("x-update-token"))) {
    return NextResponse.json({ error: "Ungültiges Update-Token." }, { status: 401 });
  }

  const state = await readUpdateState();
  if (state.status !== "RUNNING") {
    return NextResponse.json({ error: "Es läuft gerade kein Update." }, { status: 409 });
  }
  if (!isCancellable(state)) {
    return NextResponse.json(
      {
        error:
          "Der Neustart läuft bereits — ein Abbruch würde die Anwendung halb ausgetauscht zurücklassen. Bitte abwarten; schlägt er fehl, hilft „Frühere Version einspielen“.",
      },
      { status: 409 },
    );
  }

  const signalled = await cancelDeployRun();

  // Written even when there was nothing left to signal: the run is over either
  // way, and leaving a stale "building" on disk would keep the UI spinning
  // forever. This happens AFTER the kill so it supersedes the "failed" the dying
  // script writes on its way out — an abort is not a failure.
  await writeCancelledStatus();

  try {
    const user = await sessionUserForAudit();
    await recordAuditEvent(
      AUDIT_ACTIONS.systemUpdate,
      user?.email ?? "system",
      `Update abgebrochen in Phase „${state.stage}“${signalled ? "" : " (Prozess war bereits beendet)"}`,
    );
  } catch (error) {
    console.error("[update/cancel] audit", error);
  }

  return NextResponse.json({ cancelled: true, signalled }, { status: 200 });
}
