import { type NextRequest, NextResponse } from "next/server";
import { denyUnlessAdmin, sessionUserForAudit } from "@/app/lib/api-guards";
import { AUDIT_ACTIONS, recordAuditEvent } from "@/app/lib/audit";
import { readUpdateState } from "@/app/lib/update-state";
import { startDeployRun, updateTokenAccepted } from "@/app/lib/update-run";
import { allowedRollbackRefs } from "@/app/lib/version-candidates";
import { resolveVersionList } from "@/app/lib/version-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Deploy an EARLIER version.
 *
 * Mechanically this is an update with a different ref: same script, same build,
 * same detached swap. Two things make it its own endpoint rather than a
 * parameter on /api/update/trigger:
 *
 *  1. The ref is caller-supplied, so it must be validated against the versions
 *     this instance is actually allowed to run (see below).
 *  2. It runs in rollback mode, which SKIPS the database migration. `prisma db
 *     push` is forward-only: pushing an older schema at a newer database wants
 *     to drop the columns the newer version added. Leaving the newer schema in
 *     place is the safe direction — the older client simply does not know the
 *     extra columns. The UI states this before the button is pressed.
 */
export async function POST(request: NextRequest) {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  if (!updateTokenAccepted(request.headers.get("x-update-token"))) {
    return NextResponse.json({ error: "Ungültiges Update-Token." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Request-Body." }, { status: 400 });
  }

  // Shape only. Whether this ref may be deployed is decided below, against the
  // list the server itself produced — a caller-supplied string is never trusted
  // just because it looks like a tag.
  const rawRef = (body as { ref?: unknown })?.ref;
  const ref = typeof rawRef === "string" ? rawRef.trim() : "";
  if (!ref || ref.length > 200) {
    return NextResponse.json({ error: "Ungültige Anfrage: ref fehlt." }, { status: 400 });
  }

  // Refuse to start a second deploy on top of a running one. Two concurrent runs
  // would fight over the same git checkout, the same image tag and the same
  // status file — and the status file is how the UI knows what is happening, so
  // the result would be unreadable as well as broken.
  const state = await readUpdateState();
  if (state.status === "RUNNING") {
    return NextResponse.json(
      { error: "Es läuft bereits ein Update. Bitte abwarten." },
      { status: 409 },
    );
  }

  // The ref decides what code gets built and run on this host. Anything outside
  // the offered set — a branch, a fork's merge ref, an arbitrary commit — would
  // turn a hijacked admin session into remote code execution, so the set is
  // re-derived here rather than trusted from the client.
  const versions = await resolveVersionList();
  if (!allowedRollbackRefs(versions.candidates).has(ref)) {
    return NextResponse.json(
      { error: "Diese Version steht für diese Instanz nicht zur Verfügung." },
      { status: 400 },
    );
  }

  const target = versions.candidates.find((candidate) => candidate.ref === ref);
  const label = target?.label ?? ref;

  // Best-effort audit trail — never block the deploy on the session lookup or log.
  try {
    const user = await sessionUserForAudit();
    await recordAuditEvent(
      AUDIT_ACTIONS.systemRollback,
      user?.email ?? "system",
      `Rollback ausgelöst · Ziel ${label} (${ref}) · Migration übersprungen`,
    );
  } catch (error) {
    console.error("[update/rollback] audit", error);
  }

  await startDeployRun({
    ref,
    label,
    channel: versions.channel,
    mode: "rollback",
  });

  return NextResponse.json({ started: true, ref, label }, { status: 202 });
}
