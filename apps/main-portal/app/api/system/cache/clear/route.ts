import path from "node:path";
import { readdir, rm, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/lib/auth-helpers";
import { recordAuditEvent } from "@/app/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only "clear the beloved cache": wipes the Next.js on-disk cache
// (.next/cache — ISR/data/fetch caches) inside the running container. Named
// volumes (the DB) are never touched. Returns the space freed.
//
// Finding the directory is layout-dependent, and getting it wrong is silent:
//   dev  → cwd is apps/main-portal, so the cache is ./.next/cache
//   prod → the standalone server runs with cwd /app (Dockerfile WORKDIR) and
//          there is NO top-level /app/.next; the real cache sits under
//          /app/apps/main-portal/.next/cache
// The old code only ever looked at `cwd/.next/cache`, which does not exist in
// the production layout — readdir threw, the catch swallowed it, and the route
// happily reported "ok, 0 MB freed". So it never cleared anything in prod.
// Hence: probe both layouts, and say so explicitly when nothing is found rather
// than reporting a successful no-op.
//
// Note this can only ever free space in the container's WRITABLE layer. Files
// that came from the image are read-only; deleting them just records an overlayfs
// whiteout while the image layer keeps its blocks. Reclaiming those on the host
// needs `docker system prune` (and, better, not shipping them — see the
// standalone cache removal in the Dockerfile).

/** Candidate cache locations, most specific first. */
function cacheDirCandidates(): string[] {
  const explicit = process.env.CACHE_DIR;
  if (explicit) return [explicit];
  const cwd = process.cwd();
  return [
    path.join(cwd, "apps", "main-portal", ".next", "cache"), // standalone (prod)
    path.join(cwd, ".next", "cache"), // running from the app dir (dev)
  ];
}

async function resolveCacheDir(): Promise<string | null> {
  for (const dir of cacheDirCandidates()) {
    try {
      if ((await stat(dir)).isDirectory()) return dir;
    } catch {
      // not this one
    }
  }
  return null;
}

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

  const cacheDir = await resolveCacheDir();
  if (!cacheDir) {
    // Explicit, not a silent success: if the layout moves again we want to see it.
    return NextResponse.json(
      {
        ok: false,
        freedMb: 0,
        entriesCleared: 0,
        error: `Kein Next-Cache-Verzeichnis gefunden (geprüft: ${cacheDirCandidates().join(", ")}).`,
      },
      { status: 404 },
    );
  }

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
    // vanished between resolve and read — nothing to clear
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
