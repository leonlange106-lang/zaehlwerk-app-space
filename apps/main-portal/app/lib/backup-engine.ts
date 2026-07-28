import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { BACKUP_APP_ID, BACKUP_SCHEMA_VERSION, prisma } from "@zaehlwerk/database";
import { backupDirectory, findExistingDatabaseFile } from "./system-storage";

// Automated backup engine: builds full JSON snapshots (and, when a real SQLite
// file is present, a consistent binary copy via `VACUUM INTO`), lists them,
// prunes by age, and streams individual files back out. All snapshots live in
// backupDirectory() — the persistent volume in production.

// Snapshot files are named <PREFIX><timestamp>.<ext>. The strict pattern below
// is also the path-traversal guard for download/delete by name.
const SNAPSHOT_PREFIX = "zaehlwerk_backup_";
const SNAPSHOT_NAME_RE = /^zaehlwerk_backup_[0-9TZ.\-:]+\.(json|sqlite)$/;

export type SnapshotFile = {
  name: string;
  kind: "json" | "sqlite";
  sizeBytes: number;
  createdAt: string;
};

/** Build the full-backup envelope (identical shape to /api/backup/download). */
export async function buildFullBackup() {
  const [locations, zaehler, register, ablesungen, tarife] = await Promise.all([
    prisma.location.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.zaehler.findMany({ orderBy: { createdAt: "asc" } }),
    // Ohne die Register faellt ein Zweirichtungszaehler beim Einspielen wieder
    // in EINE Reihe zusammen — und die Zuordnung steht danach nirgends mehr.
    prisma.meterRegister.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.ablesung.findMany({ orderBy: { datum: "asc" } }),
    prisma.tarif.findMany({ orderBy: { gueltigAb: "asc" } }),
  ]);

  return {
    app: BACKUP_APP_ID,
    kind: "full-backup" as const,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    data: { locations, zaehler, register, ablesungen, tarife },
  };
}

/** File-system-safe timestamp, e.g. 2026-07-23T12-30-00-000Z. */
function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export type SnapshotResult = {
  jsonName: string;
  sqliteName: string | null;
  totalBytes: number;
};

/**
 * Write a JSON snapshot and — when the SQLite file exists — a binary snapshot.
 * `VACUUM INTO` produces a fully consistent copy without locking out writers,
 * which is exactly what an unattended backup needs.
 */
export async function createSnapshot(): Promise<SnapshotResult> {
  const dir = backupDirectory();
  await mkdir(dir, { recursive: true });

  const stamp = timestamp();
  const backup = await buildFullBackup();
  const json = JSON.stringify(backup, null, 2);
  const jsonName = `${SNAPSHOT_PREFIX}${stamp}.json`;
  await writeFile(path.join(dir, jsonName), json, "utf8");

  let sqliteName: string | null = null;
  const dbFile = findExistingDatabaseFile();
  if (dbFile) {
    sqliteName = `${SNAPSHOT_PREFIX}${stamp}.sqlite`;
    // Single-quote-escape for the SQL string literal. VACUUM cannot run inside a
    // transaction, so use the un-transactioned raw executor.
    const target = path.join(dir, sqliteName).replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${target}'`);
  }

  let totalBytes = Buffer.byteLength(json, "utf8");
  if (sqliteName) {
    try {
      totalBytes += (await stat(path.join(dir, sqliteName))).size;
    } catch {
      // ignore — size is informational
    }
  }

  return { jsonName, sqliteName, totalBytes };
}

export async function listSnapshots(): Promise<SnapshotFile[]> {
  const dir = backupDirectory();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return []; // directory not created yet → no snapshots
  }

  const files = await Promise.all(
    entries
      .filter((name) => SNAPSHOT_NAME_RE.test(name))
      .map(async (name): Promise<SnapshotFile | null> => {
        try {
          const info = await stat(path.join(dir, name));
          return {
            name,
            kind: name.endsWith(".sqlite") ? "sqlite" : "json",
            sizeBytes: info.size,
            createdAt: info.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      }),
  );

  return files
    .filter((file): file is SnapshotFile => file !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Delete snapshots older than `retentionDays`. A retention of 0 means "keep
 * forever" and prunes nothing. Returns the number of files removed.
 */
export async function pruneSnapshots(retentionDays: number): Promise<number> {
  if (retentionDays <= 0) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const snapshots = await listSnapshots();
  const dir = backupDirectory();

  let removed = 0;
  for (const snapshot of snapshots) {
    if (new Date(snapshot.createdAt).getTime() < cutoff) {
      try {
        await unlink(path.join(dir, snapshot.name));
        removed += 1;
      } catch (error) {
        console.error("[pruneSnapshots]", snapshot.name, error);
      }
    }
  }
  return removed;
}

function safeSnapshotName(name: string): string | null {
  const base = path.basename(name);
  return SNAPSHOT_NAME_RE.test(base) ? base : null;
}

/** Read a single snapshot file. Guards against path traversal via the name. */
export async function readSnapshot(name: string): Promise<Buffer | null> {
  const safe = safeSnapshotName(name);
  if (!safe) return null;
  try {
    return await readFile(path.join(backupDirectory(), safe));
  } catch {
    return null;
  }
}

/** Delete a single snapshot by name. Returns true if a file was removed. */
export async function deleteSnapshot(name: string): Promise<boolean> {
  const safe = safeSnapshotName(name);
  if (!safe) return false;
  try {
    await unlink(path.join(backupDirectory(), safe));
    return true;
  } catch {
    return false;
  }
}
