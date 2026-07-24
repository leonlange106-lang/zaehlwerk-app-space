import { stat } from "node:fs/promises";
import { prisma } from "@zaehlwerk/database";
import { findExistingDatabaseFile } from "./system-storage";

// SQLite statistics + maintenance. VACUUM reclaims space left behind by large
// deletes (bulk imports rolled back, retention pruning of readings, etc.);
// `PRAGMA optimize` refreshes the query planner's statistics. Both are safe to
// run online on a single-writer home-server DB.

export type DatabaseStats = {
  sizeBytes: number | null;
  /** Bytes occupied by the raw datalog CSVs, or null when unavailable. */
  logCsvBytes: number | null;
  counts: {
    users: number;
    tokens: number;
    zaehler: number;
    ablesungen: number;
    tarife: number;
    locations: number;
    auditLogs: number;
    logFiles: number;
  };
};

export async function getDatabaseStats(): Promise<DatabaseStats> {
  const [users, tokens, zaehler, ablesungen, tarife, locations, auditLogs, logFiles] =
    await Promise.all([
      prisma.user.count(),
      prisma.apiToken.count(),
      prisma.zaehler.count(),
      prisma.ablesung.count(),
      prisma.tarif.count(),
      prisma.location.count(),
      prisma.auditLog.count(),
      prisma.logFile.count(),
    ]);

  return {
    sizeBytes: await databaseSizeBytes(),
    logCsvBytes: await logCsvBytes(),
    counts: { users, tokens, zaehler, ablesungen, tarife, locations, auditLogs, logFiles },
  };
}

/**
 * Total size of the stored raw CSVs. This is the column that actually drives DB
 * growth, so the maintenance UI shows it next to the file size to make the case
 * for a retention policy concrete. Aggregated in SQL — reading the CSVs into the
 * app just to measure them would defeat the purpose.
 */
async function logCsvBytes(): Promise<number | null> {
  try {
    const rows = await prisma.$queryRaw<{ bytes: number | bigint | null }[]>`
      SELECT COALESCE(SUM(LENGTH(csv)), 0) AS bytes FROM log_files
    `;
    const value = rows[0]?.bytes;
    return value === null || value === undefined ? null : Number(value);
  } catch {
    return null;
  }
}

/** Sum of the DB file and its WAL/SHM sidecars, or null if the file is absent. */
async function databaseSizeBytes(): Promise<number | null> {
  const dbFile = findExistingDatabaseFile();
  if (!dbFile) return null;

  let total = 0;
  let found = false;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      total += (await stat(dbFile + suffix)).size;
      found = true;
    } catch {
      // sidecar absent (WAL checkpointed away) — fine
    }
  }
  return found ? total : null;
}

/** Reclaim unused pages. Returns the bytes freed (best-effort, may be 0). */
export async function vacuumDatabase(): Promise<{ freedBytes: number }> {
  const before = (await databaseSizeBytes()) ?? 0;
  // VACUUM must not run inside a transaction.
  await prisma.$executeRawUnsafe("VACUUM");
  const after = (await databaseSizeBytes()) ?? before;
  return { freedBytes: Math.max(0, before - after) };
}

/** Refresh the query planner's internal statistics. */
export async function optimizeDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe("PRAGMA optimize");
}
