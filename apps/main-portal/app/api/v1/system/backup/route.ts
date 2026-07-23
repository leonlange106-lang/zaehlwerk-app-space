import { NextResponse } from "next/server";
import { authenticateApiRequest, unauthorizedResponse } from "../../../../lib/api-auth";
import { AUDIT_ACTIONS, recordAuditEvent } from "../../../../lib/audit";
import {
  buildFullBackup,
  createSnapshot,
  listSnapshots,
  pruneSnapshots,
  readSnapshot,
} from "../../../../lib/backup-engine";
import { getBackupPolicy, markBackupRun } from "../../../../lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * System backup API for external/offsite scripts (Proxmox, Home Assistant, …)
 * authenticating with `Authorization: Bearer zw_pat_…`.
 *
 *   GET                       → fresh full JSON backup (any authenticated user)
 *   GET ?list=1               → list persisted snapshots (admin)
 *   GET ?file=<snapshot-name> → download a persisted snapshot (admin)
 *   POST                      → create a snapshot now + apply retention (admin)
 */
export async function GET(request: Request) {
  const user = await authenticateApiRequest(request);
  if (!user) return unauthorizedResponse();

  const url = new URL(request.url);

  if (url.searchParams.get("list") !== null) {
    if (user.role !== "ADMIN") return forbidden();
    return NextResponse.json({ snapshots: await listSnapshots() }, { headers: { "Cache-Control": "no-store" } });
  }

  const file = url.searchParams.get("file");
  if (file) {
    if (user.role !== "ADMIN") return forbidden();
    const buffer = await readSnapshot(file);
    if (!buffer) return NextResponse.json({ error: "Snapshot nicht gefunden." }, { status: 404 });
    const isJson = file.endsWith(".json");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": isJson ? "application/json; charset=utf-8" : "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Default: stream a fresh full backup for offsite pulls.
  const backup = await buildFullBackup();
  const json = JSON.stringify(backup, null, 2);
  const datum = backup.generatedAt.slice(0, 10);
  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="zaehlwerk_backup_${datum}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const user = await authenticateApiRequest(request);
  if (!user) return unauthorizedResponse();
  if (user.role !== "ADMIN") return forbidden();

  try {
    const result = await createSnapshot();
    await markBackupRun();
    const policy = await getBackupPolicy();
    const pruned = await pruneSnapshots(policy.retentionDays);

    await recordAuditEvent(
      AUDIT_ACTIONS.backupCreate,
      `${user.email} (${user.via})`,
      `${result.jsonName}${result.sqliteName ? ` + ${result.sqliteName}` : ""}` +
        (pruned > 0 ? ` (${pruned} alte gelöscht)` : ""),
    );

    return NextResponse.json(
      {
        ok: true,
        json: result.jsonName,
        sqlite: result.sqliteName,
        totalBytes: result.totalBytes,
        pruned,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[POST /api/v1/system/backup]", error);
    return NextResponse.json({ error: "Backup fehlgeschlagen." }, { status: 500 });
  }
}
