import { pruneLogs } from "./log-repository";
import { optimizeDatabase, vacuumDatabase } from "./db-maintenance";
import { getLogRetentionPolicy, markMaintenanceRun } from "./settings";

// Storage housekeeping, shared by the nightly scheduler and the admin button in
// the settings UI so both do exactly the same thing.
//
// Order matters: prune first, then VACUUM. Deleting rows in SQLite only marks
// their pages free — the file itself never shrinks until a VACUUM rewrites it.
// Pruning without vacuuming would therefore reclaim no disk at all, which is the
// whole point of the exercise on a box that runs out of space.
//
// VACUUM rewrites the entire database and needs room for a second copy, so we
// only pay for it when something was actually deleted. `PRAGMA optimize` is
// cheap and runs either way to keep the query planner's statistics current.

export type MaintenanceReport = {
  /** Logs removed by the retention policy. */
  prunedLogs: number;
  /** Bytes handed back to the filesystem by VACUUM. */
  freedBytes: number;
  /** False when no retention limit is configured — nothing was pruned. */
  retentionEnabled: boolean;
};

export async function runMaintenance(): Promise<MaintenanceReport> {
  const policy = await getLogRetentionPolicy();
  const retentionEnabled = policy.retentionDays > 0 || policy.maxCount > 0;

  const { deleted } = retentionEnabled
    ? await pruneLogs({ retentionDays: policy.retentionDays, maxCount: policy.maxCount })
    : { deleted: 0 };

  let freedBytes = 0;
  if (deleted > 0) {
    ({ freedBytes } = await vacuumDatabase());
  }
  await optimizeDatabase();
  await markMaintenanceRun();

  return { prunedLogs: deleted, freedBytes, retentionEnabled };
}
