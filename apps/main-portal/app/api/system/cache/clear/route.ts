import path from "node:path";
import { readdir, rm, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/lib/auth-helpers";
import { recordAuditEvent } from "@/app/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only "clear the beloved cache": wipes the Next.js on-disk cache
// (.next/cache — ISR/data/fetch caches) inside the running container to reclaim
// disk. Named volumes (the DB) are never touched. Returns the space freed.

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const s = await stat(full);
      if (s.isDirectory()) total += await dirSize(full);
      else total += s.size;
    } catch {
      // vanished mid-scan — ignore
    }
  }
  return total;
}

export async function POST() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Nur für Administratoren." }, { status: 403 });
  }

  const cacheDir = process.env.CACHE_DIR ?? path.join(process.cwd(), ".next", "cache");
  const before = await dirSize(cacheDir);

  let cleared = 0;
  try {
    const entries = await readdir(cacheDir, { withFileTypes: true });
    for (const entry of entries) {
      try {
        await rm(path.join(cacheDir, entry.name), { recursive: true, force: true });
        cleared += 1;
      } catch {
        // best-effort per entry
      }
    }
  } catch {
    // no cache dir yet — nothing to clear
  }

  const after = await dirSize(cacheDir);
  const freedMb = Math.max(0, Math.round((before - after) / (1024 * 1024)));

  try {
    await recordAuditEvent("system.cache.clear", user.email ?? "system", `${freedMb} MB freigegeben`);
  } catch {
    // audit best-effort
  }

  return NextResponse.json({ ok: true, freedMb, entriesCleared: cleared });
}
