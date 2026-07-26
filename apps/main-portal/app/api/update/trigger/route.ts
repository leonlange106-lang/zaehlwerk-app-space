import { type NextRequest, NextResponse } from "next/server";
import { denyUnlessAdmin, sessionUserForAudit } from "@/app/lib/api-guards";
import { AUDIT_ACTIONS, recordAuditEvent } from "../../../lib/audit";
import { readUpdateState } from "@/app/lib/update-state";
import { startDeployRun, updateTokenAccepted, updateTokenRequired } from "@/app/lib/update-run";
import { resolveUpdateTarget } from "@/app/lib/update-target";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lets the UI know whether the token field is needed, so it doesn't ask for a
 * secret that isn't configured on the server.
 */
export async function GET() {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  return NextResponse.json(
    { tokenRequired: updateTokenRequired() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Kicks off scripts/update.sh as a detached background process and returns
 * immediately. The script builds the new image, migrates the DB, then hands the
 * actual restart to a separate deployer container (see scripts/update.sh).
 *
 * Restricted to signed-in ADMINs. `UPDATE_TRIGGER_TOKEN`, when configured, is an
 * ADDITIONAL shared-secret header on top of that — it is not a substitute, which
 * is what it used to be back when this app had no user/session system: with the
 * token unset (the default) every signed-in user could rebuild and restart the
 * container. See DEPLOYMENT.md.
 */
export async function POST(request: NextRequest) {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  if (!updateTokenAccepted(request.headers.get("x-update-token"))) {
    return NextResponse.json({ error: "Ungültiges Update-Token." }, { status: 401 });
  }

  // Two concurrent deploys would fight over the same checkout, image tag and
  // status file. Same guard as the rollback endpoint, for the same reason.
  const state = await readUpdateState();
  if (state.status === "RUNNING") {
    return NextResponse.json(
      { error: "Es läuft bereits ein Update. Bitte abwarten." },
      { status: 409 },
    );
  }

  // Which ref this instance's channel points at. Resolved HERE rather than in
  // the script: the channel lives in the database, and the script has no client.
  const target = await resolveUpdateTarget();

  // Best-effort audit trail — never block the update on the session lookup or log.
  try {
    const user = await sessionUserForAudit();
    await recordAuditEvent(
      AUDIT_ACTIONS.systemUpdate,
      user?.email ?? "system",
      `Update ausgelöst · Channel ${target.channel} · Ziel ${target.label}`,
    );
  } catch (error) {
    console.error("[update/trigger] audit", error);
  }

  await startDeployRun({
    ref: target.ref,
    label: target.label,
    channel: target.channel,
    mode: "update",
  });

  return NextResponse.json({ started: true }, { status: 202 });
}
