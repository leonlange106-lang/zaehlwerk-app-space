// In-process scheduler for automated backups. Started once from
// instrumentation.ts on server boot. It wakes up hourly and, if auto-backups
// are enabled and the configured interval has elapsed since the last run,
// creates a snapshot and prunes by the retention policy.
//
// This deliberately runs inside the single app container (no external cron
// needed). External schedulers can still drive POST /api/v1/system/backup via
// a PAT — both paths share the same engine, so they cooperate cleanly.

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

let started = false;

async function runDueBackup(): Promise<void> {
  // Import lazily so this module stays free of Node/Prisma at module-eval time.
  const { getBackupPolicy, markBackupRun } = await import("./settings");
  const { createSnapshot, pruneSnapshots } = await import("./backup-engine");
  const { recordAuditEvent, AUDIT_ACTIONS } = await import("./audit");
  const { deployInProgress } = await import("./update-run");

  // Nicht waehrend eines Deploys. `createSnapshot` kopiert die Datenbank mit
  // `VACUUM INTO` und haelt dabei eine Lesetransaktion ueber die ganze Kopie
  // offen — ohne WAL sperrt das jeden Schreiber aus, auch die Migration des
  // Updates, die absichtlich neben der laufenden Anwendung arbeitet. Genau so
  // ist ein Update gescheitert.
  //
  // Verschieben kostet nichts: Der Deploy sichert die Datei ohnehin selbst,
  // bevor er sie anfasst, und der naechste Weckruf holt das Backup nach.
  if (await deployInProgress()) {
    console.info("[backup-scheduler] Deploy laeuft — Backup wird verschoben");
    return;
  }

  const policy = await getBackupPolicy();
  if (!policy.autoEnabled) return;

  const last = policy.lastRunAt ? new Date(policy.lastRunAt).getTime() : 0;
  const dueAt = last + policy.intervalHours * 60 * 60 * 1000;
  if (Date.now() < dueAt) return;

  const result = await createSnapshot();
  await markBackupRun();
  const pruned = await pruneSnapshots(policy.retentionDays);
  await recordAuditEvent(
    AUDIT_ACTIONS.backupCreate,
    "system (auto)",
    `${result.jsonName}${result.sqliteName ? ` + ${result.sqliteName}` : ""}` +
      (pruned > 0 ? ` (${pruned} alte gelöscht)` : ""),
  );
  console.info("[backup-scheduler] automatic snapshot created:", result.jsonName);
}

export function startBackupScheduler(): void {
  if (started) return;
  started = true;

  const tick = () => {
    runDueBackup().catch((error) => console.error("[backup-scheduler]", error));
  };

  // A short initial delay lets the server finish booting before the first check.
  setTimeout(tick, 30_000).unref?.();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref?.();
}
