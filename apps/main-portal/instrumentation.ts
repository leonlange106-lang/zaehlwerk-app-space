// Next.js runs register() once per server process on boot. We use it to start
// the in-process automated-backup scheduler — but only in the Node.js runtime
// (never Edge, never during the build), and never crashing the server if the
// scheduler can't start.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startBackupScheduler } = await import("./app/lib/backup-scheduler");
    startBackupScheduler();
  } catch (error) {
    console.error("[instrumentation] failed to start backup scheduler", error);
  }
}
