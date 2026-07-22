import { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function tokensMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Kicks off scripts/update.sh (git pull + `docker compose up -d --build`) as a
 * detached background process and returns immediately — the script will end
 * up restarting the very container handling this request.
 *
 * Protected by a shared-secret header rather than full auth, since this app
 * has no user/session system yet. This alone is NOT sufficient for exposing
 * the endpoint to the internet — see DEPLOYMENT.md: it must sit behind a
 * trusted network boundary (VPN/reverse-proxy allowlist) in production.
 */
export async function POST(request: NextRequest) {
  const expectedToken = process.env.UPDATE_TRIGGER_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "UPDATE_TRIGGER_TOKEN ist auf dem Server nicht konfiguriert." },
      { status: 503 },
    );
  }

  const providedToken = request.headers.get("x-update-token") ?? "";
  if (!providedToken || !tokensMatch(providedToken, expectedToken)) {
    return NextResponse.json({ error: "Ungültiges Update-Token." }, { status: 401 });
  }

  const scriptPath =
    process.env.UPDATE_SCRIPT_PATH ?? path.resolve(process.cwd(), "..", "..", "scripts", "update.sh");

  const child = spawn("sh", [scriptPath], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  return NextResponse.json({ started: true }, { status: 202 });
}
