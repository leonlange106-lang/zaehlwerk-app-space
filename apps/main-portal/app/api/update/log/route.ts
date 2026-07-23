import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Written (and truncated each run) by scripts/update.sh. Lives on the persistent
// /data volume, so it survives the container recreation mid-update and the new
// container serves the SAME full log — letting the UI show the whole run.
const LOG_FILE = process.env.UPDATE_LOG_FILE ?? "/data/update.log";

// Cap the response so a runaway build log can't balloon the payload; the tail is
// what matters for "what's happening right now".
const MAX_BYTES = 200_000;

export async function GET() {
  try {
    const raw = await readFile(LOG_FILE, "utf8");
    const text = raw.length > MAX_BYTES ? raw.slice(raw.length - MAX_BYTES) : raw;
    return new NextResponse(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    // No log yet (never updated) or unreadable.
    return new NextResponse("", {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
