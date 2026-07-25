import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { denyUnlessAdmin } from "@/app/lib/api-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Written by scripts/update.sh at each stage; read here for the UI stepper.
const STATUS_FILE = process.env.UPDATE_STATUS_FILE ?? "/data/update-status.json";

export async function GET() {
  const denied = await denyUnlessAdmin();
  if (denied) return denied;

  try {
    const raw = await readFile(STATUS_FILE, "utf8");
    return NextResponse.json(JSON.parse(raw), { headers: { "Cache-Control": "no-store" } });
  } catch {
    // No file yet (never updated) or unreadable → nothing running.
    return NextResponse.json({ stage: "idle" }, { headers: { "Cache-Control": "no-store" } });
  }
}
