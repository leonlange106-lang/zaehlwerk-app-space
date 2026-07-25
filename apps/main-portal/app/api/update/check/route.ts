import { NextResponse } from "next/server";
import { checkForUpdates } from "@zaehlwerk/updater";
import { getRepoRoot, getRunningBuildSha } from "../../../lib/version";
import { denyUnlessAdmin } from "@/app/lib/api-guards";
import { resolveUpdateTarget } from "@/app/lib/update-target";

export const dynamic = "force-dynamic";

const REPO_OWNER = "leonlange106-lang";
const REPO_NAME = "zaehlwerk-app-space";

export async function GET() {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  const target = await resolveUpdateTarget();

  try {
    const result = await checkForUpdates({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      branch: process.env.UPDATE_BRANCH ?? "main",
      channel: target.channel,
      // Compare GitHub against the actually-running build, not the (possibly
      // already-pulled-ahead) git checkout — falls back to git when unbaked.
      currentSha: getRunningBuildSha(),
      cwd: getRepoRoot(),
    });
    return NextResponse.json({ ...result, target });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unbekannter Fehler bei der Update-Prüfung." },
      { status: 502 },
    );
  }
}
