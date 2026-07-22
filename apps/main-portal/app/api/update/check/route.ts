import { NextResponse } from "next/server";
import { checkForUpdates } from "@zaehlwerk/updater";
import { getRepoRoot } from "../../../lib/version";

export const dynamic = "force-dynamic";

const REPO_OWNER = "leonlange106-lang";
const REPO_NAME = "zaehlwerk-app-space";

export async function GET() {
  try {
    const result = await checkForUpdates({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      branch: process.env.UPDATE_BRANCH ?? "main",
      cwd: getRepoRoot(),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unbekannter Fehler bei der Update-Prüfung." },
      { status: 502 },
    );
  }
}
