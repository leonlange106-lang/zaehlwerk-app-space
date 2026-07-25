import { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { denyUnlessAdmin, sessionUserForAudit } from "@/app/lib/api-guards";
import { AUDIT_ACTIONS, recordAuditEvent } from "../../../lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_FILE = process.env.UPDATE_STATUS_FILE ?? "/data/update-status.json";

function tokenRequired(): boolean {
  return Boolean(process.env.UPDATE_TRIGGER_TOKEN);
}

function tokensMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Lets the UI know whether the token field is needed, so it doesn't ask for a
 * secret that isn't configured on the server.
 */
export async function GET() {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  return NextResponse.json(
    { tokenRequired: tokenRequired() },
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

  const expectedToken = process.env.UPDATE_TRIGGER_TOKEN;
  if (expectedToken) {
    const providedToken = request.headers.get("x-update-token") ?? "";
    if (!providedToken || !tokensMatch(providedToken, expectedToken)) {
      return NextResponse.json({ error: "Ungültiges Update-Token." }, { status: 401 });
    }
  }

  // Write an initial "started" status synchronously BEFORE spawning the script,
  // so the UI never briefly reads a stale "done" from a previous run and
  // reports false success. Best-effort — the script overwrites it immediately.
  try {
    await writeFile(
      STATUS_FILE,
      JSON.stringify({
        stage: "started",
        ok: true,
        done: false,
        message: "Update wird gestartet",
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // /data not writable in some dev setups — the script handles status too.
  }

  const scriptPath =
    process.env.UPDATE_SCRIPT_PATH ?? path.resolve(process.cwd(), "..", "..", "scripts", "update.sh");

  // Best-effort audit trail — never block the update on the session lookup or log.
  try {
    const user = await sessionUserForAudit();
    await recordAuditEvent(AUDIT_ACTIONS.systemUpdate, user?.email ?? "system", "Update ausgelöst");
  } catch (error) {
    console.error("[update/trigger] audit", error);
  }

  const child = spawn("sh", [scriptPath], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  return NextResponse.json({ started: true }, { status: 202 });
}
