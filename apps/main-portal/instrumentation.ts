// Next.js runs register() once per server process on boot. We use it to start
// the in-process background services — the automated-backup scheduler and the
// log watch-folder importer — but only in the Node.js runtime (never Edge, never
// during the build), and never crashing the server if one can't start.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // ZUERST: Die Betriebsparameter gelten je Verbindung, und alles darunter
  // schreibt bereits. Ohne WAL sperrt jeder Hintergrunddienst kurzzeitig die
  // ganze Datei — genau waehrend jemand die Oberflaeche benutzt.
  try {
    const { applySqlitePragmas } = await import("./app/lib/sqlite-pragmas");
    const { failed } = await applySqlitePragmas();
    if (failed.length > 0) {
      console.warn("[instrumentation] SQLite-Parameter nicht gesetzt:", failed.join(", "));
    }
  } catch (error) {
    console.error("[instrumentation] failed to apply sqlite pragmas", error);
  }

  try {
    const { startBackupScheduler } = await import("./app/lib/backup-scheduler");
    startBackupScheduler();
  } catch (error) {
    console.error("[instrumentation] failed to start backup scheduler", error);
  }

  try {
    const { startMaintenanceScheduler } = await import("./app/lib/maintenance-scheduler");
    startMaintenanceScheduler();
  } catch (error) {
    console.error("[instrumentation] failed to start maintenance scheduler", error);
  }

  try {
    // No-op unless LOG_WATCH_DIR is configured (see watcher/config.ts).
    const { startWatchFolder } = await import("./app/apps/log-analyzer/watcher/watch-folder");
    await startWatchFolder();
  } catch (error) {
    console.error("[instrumentation] failed to start watch-folder", error);
  }
}
