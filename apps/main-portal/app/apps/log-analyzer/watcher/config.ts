import path from "node:path";

// Configuration for the automated watch-folder importer, sourced from env so it
// can be pointed at a Docker volume / LXC mount / HAOS shared folder without code
// changes. When LOG_WATCH_DIR is unset the watcher stays OFF (the default in dev
// and for anyone not using it) — see instrumentation.ts.

export interface WatchConfig {
  /** Directory scanned for incoming `.csv` files. */
  dir: string;
  /** Where successfully-imported files are moved. */
  processedDir: string;
  /** Where files that failed to import are moved. */
  failedDir: string;
  /** Poll interval (ms). Polling (not fs.watch) is deliberate: it is reliable on
   *  network / bind-mounted shares where inotify events are unreliable. */
  pollMs: number;
  /** A file must keep the same size for this long before it's considered fully
   *  written (guards against importing a half-copied file). */
  settleMs: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Resolve the watch config from env, or null when the watcher is disabled. */
export function resolveWatchConfig(env: NodeJS.ProcessEnv = process.env): WatchConfig | null {
  const dir = env.LOG_WATCH_DIR?.trim();
  if (!dir) return null;
  return {
    dir,
    processedDir: env.LOG_WATCH_PROCESSED_DIR?.trim() || path.join(dir, "processed"),
    failedDir: env.LOG_WATCH_FAILED_DIR?.trim() || path.join(dir, "failed"),
    pollMs: num(env.LOG_WATCH_POLL_MS, 5_000),
    settleMs: num(env.LOG_WATCH_SETTLE_MS, 2_000),
  };
}
