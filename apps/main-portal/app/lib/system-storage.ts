import { existsSync } from "node:fs";
import path from "node:path";

// Server-only helpers that locate the SQLite database file and the directory
// where automated backups live. Both derive from DATABASE_URL so a single
// env var drives production (`file:/data/zaehlwerk.db` → snapshots in
// `/data/backups`, i.e. the persistent volume) and dev alike.

/**
 * Candidate absolute paths for the SQLite file behind DATABASE_URL. Absolute
 * URLs (production) resolve to exactly one path; relative URLs (`file:./dev.db`
 * in dev) are ambiguous because Prisma resolves them relative to the schema
 * dir, not the app's cwd — so we try both.
 */
function databaseFileCandidates(): string[] {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return [];

  let file = url.slice("file:".length);
  const query = file.indexOf("?");
  if (query >= 0) file = file.slice(0, query);
  if (!file) return [];

  if (path.isAbsolute(file)) return [file];

  // Dev: DATABASE_URL is relative to packages/database/prisma (schema location),
  // but the running Next app's cwd is apps/main-portal. Cover both.
  return [
    path.resolve(process.cwd(), file),
    path.resolve(process.cwd(), "..", "..", "packages", "database", "prisma", file),
  ];
}

/** The DATABASE_URL path Prisma itself uses (first candidate), or null. */
export function resolveDatabaseFile(): string | null {
  return databaseFileCandidates()[0] ?? null;
}

/** The first candidate that actually exists on disk, or null. */
export function findExistingDatabaseFile(): string | null {
  return databaseFileCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Where automated snapshots are written. Defaults to a `backups/` folder next
 * to the database file (so it lands on the same persistent volume in prod), or
 * BACKUP_DIR if explicitly overridden.
 */
export function backupDirectory(): string {
  const override = process.env.BACKUP_DIR;
  if (override) return override;

  const dbFile = findExistingDatabaseFile() ?? resolveDatabaseFile();
  if (dbFile) return path.join(path.dirname(dbFile), "backups");
  return path.resolve(process.cwd(), "backups");
}
