// In-process scheduler for storage housekeeping (log retention + VACUUM),
// started once from instrumentation.ts on server boot. Mirrors
// backup-scheduler.ts: it wakes up hourly and only does real work when the
// configured interval has elapsed, so a container restart can't turn it into a
// busy loop.
//
// Runs daily rather than hourly because VACUUM rewrites the whole database —
// worth doing regularly, not repeatedly. When no retention limit is configured
// (the default) the run is a cheap `PRAGMA optimize` and nothing else.

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly wake-up
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000; // …but act at most once a day

let started = false;

async function runDueMaintenance(): Promise<void> {
  // Imported lazily so this module stays free of Prisma at module-eval time.
  const { getLogRetentionPolicy } = await import("./settings");
  const { runMaintenance } = await import("./maintenance");
  const { recordAuditEvent, AUDIT_ACTIONS } = await import("./audit");

  const { lastRunAt } = await getLogRetentionPolicy();
  const last = lastRunAt ? new Date(lastRunAt).getTime() : 0;
  if (Date.now() < last + RUN_INTERVAL_MS) return;

  const report = await runMaintenance();

  // Only leave an audit entry when something was actually reclaimed — a daily
  // "did nothing" row would push the genuinely interesting events out of the
  // trimmed audit log within a couple of months.
  if (report.prunedLogs > 0) {
    await recordAuditEvent(
      AUDIT_ACTIONS.logPrune,
      "system (auto)",
      `${report.prunedLogs} Log(s) nach Aufbewahrungsfrist gelöscht, ${report.freedBytes} Bytes freigegeben`,
    );
    console.info(
      `[maintenance-scheduler] pruned ${report.prunedLogs} log(s), freed ${report.freedBytes} bytes`,
    );
  }
}

export function startMaintenanceScheduler(): void {
  if (started) return;
  started = true;

  const tick = () => {
    runDueMaintenance().catch((error) => console.error("[maintenance-scheduler]", error));
  };

  // Offset from the backup scheduler's 30s so a cold start doesn't run a backup
  // and a VACUUM over the same database at the same moment.
  setTimeout(tick, 90_000).unref?.();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref?.();
}
