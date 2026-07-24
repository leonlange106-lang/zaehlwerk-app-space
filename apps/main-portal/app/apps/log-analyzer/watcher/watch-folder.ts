import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { ingestCsv, type IngestResult } from "@/app/lib/log-ingest";
import { resolveWatchConfig, type WatchConfig } from "./config";

// Background watch-folder importer. Polls a configured directory for new `.csv`
// files, waits until each file has finished being written (size stable for
// settleMs), imports it through the shared ingestion pipeline (parse + evaluate +
// dedup + SSE broadcast), then moves it to /processed — or /failed on error.
//
// Started once from instrumentation.ts on server boot (only when LOG_WATCH_DIR is
// set). Deliberately polling-based so it works over network / bind-mounted shares
// where inotify (fs.watch) events are unreliable. Deduplication is handled by the
// ingestion layer (SHA-256 of the CSV), so re-dropping the same file is a no-op.

/** Injectable dependency seam so the file-processing flow is unit-testable. */
export interface WatchDeps {
  ingest: (params: Parameters<typeof ingestCsv>[0]) => Promise<IngestResult>;
}

const defaultDeps: WatchDeps = { ingest: ingestCsv };

const CSV_RE = /\.csv$/i;

async function ensureDirs(config: WatchConfig): Promise<void> {
  await mkdir(config.dir, { recursive: true });
  await mkdir(config.processedDir, { recursive: true });
  await mkdir(config.failedDir, { recursive: true });
}

/** Move a file into `destDir`, avoiding name collisions and crossing devices. */
export async function moveInto(filePath: string, destDir: string): Promise<string> {
  const base = path.basename(filePath);
  let dest = path.join(destDir, base);
  // On a name collision, prefix a timestamp rather than overwrite.
  try {
    await access(dest, constants.F_OK);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    dest = path.join(destDir, `${stamp}_${base}`);
  } catch {
    // no collision
  }
  try {
    await rename(filePath, dest);
  } catch (error) {
    // Cross-device (EXDEV) rename fails on some mounts → copy + unlink.
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      await copyFile(filePath, dest);
      await unlink(filePath);
    } else {
      throw error;
    }
  }
  return dest;
}

/**
 * Import a single CSV file, then move it to processed/failed. Returns the outcome
 * (the ingest result on success). Pure of any timer/polling concern so it can be
 * unit-tested against a temp directory with an injected ingest.
 */
export async function processWatchFile(
  filePath: string,
  config: WatchConfig,
  deps: WatchDeps = defaultDeps,
): Promise<{ outcome: "processed" | "failed"; result?: IngestResult; error?: unknown }> {
  try {
    const csv = await readFile(filePath, "utf8");
    if (!csv.trim()) throw new Error("empty file");
    const result = await deps.ingest({ name: path.basename(filePath), csv, source: "watch" });
    await moveInto(filePath, config.processedDir);
    return { outcome: "processed", result };
  } catch (error) {
    console.error("[watch-folder] failed to import", filePath, error);
    try {
      await moveInto(filePath, config.failedDir);
    } catch (moveError) {
      console.error("[watch-folder] could not move failed file", filePath, moveError);
    }
    return { outcome: "failed", error };
  }
}

// ── Polling loop ────────────────────────────────────────────────────────────

/** Per-file size/first-seen tracking used to detect a fully-written file. */
type PendingMap = Map<string, { size: number; since: number }>;

/**
 * One scan pass: find stable `.csv` files and import them. Exposed for testing.
 * `pending` carries stability state between passes; `inFlight` guards a file from
 * being picked up twice while its (awaited) import is running.
 */
export async function scanOnce(
  config: WatchConfig,
  pending: PendingMap,
  inFlight: Set<string>,
  deps: WatchDeps = defaultDeps,
  now: number = Date.now(),
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(config.dir);
  } catch {
    return; // dir vanished mid-run (unmounted) — try again next tick
  }

  const seen = new Set<string>();
  const started: Promise<unknown>[] = [];
  for (const name of entries) {
    if (!CSV_RE.test(name)) continue;
    const filePath = path.join(config.dir, name);
    if (inFlight.has(filePath)) continue;

    let info;
    try {
      info = await stat(filePath);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    seen.add(filePath);

    const prev = pending.get(filePath);
    if (!prev || prev.size !== info.size) {
      // First sight, or still growing → (re)start the settle timer.
      pending.set(filePath, { size: info.size, since: now });
      continue;
    }
    if (now - prev.since < config.settleMs) continue; // not settled yet

    // Stable → import it. Mark in-flight so a concurrent pass skips it.
    pending.delete(filePath);
    inFlight.add(filePath);
    started.push(processWatchFile(filePath, config, deps).finally(() => inFlight.delete(filePath)));
  }

  // Forget tracking for files that disappeared (moved/deleted) between passes.
  for (const key of pending.keys()) {
    if (!seen.has(key)) pending.delete(key);
  }

  await Promise.all(started);
}

let started = false;

/**
 * Start the watch-folder importer if LOG_WATCH_DIR is configured. Idempotent and
 * never throws — a watcher that can't start must not crash the server.
 */
export async function startWatchFolder(deps: WatchDeps = defaultDeps): Promise<void> {
  if (started) return;
  const config = resolveWatchConfig();
  if (!config) {
    console.info("[watch-folder] disabled (LOG_WATCH_DIR not set)");
    return;
  }
  started = true;

  try {
    await ensureDirs(config);
  } catch (error) {
    console.error("[watch-folder] could not prepare directories", error);
    started = false;
    return;
  }

  const pending: PendingMap = new Map();
  const inFlight = new Set<string>();
  let scanning = false;

  const tick = async () => {
    if (scanning) return; // never overlap scans
    scanning = true;
    try {
      await scanOnce(config, pending, inFlight, deps);
    } catch (error) {
      console.error("[watch-folder] scan error", error);
    } finally {
      scanning = false;
    }
  };

  console.info(`[watch-folder] watching ${config.dir} (poll ${config.pollMs}ms)`);
  const timer = setInterval(() => void tick(), config.pollMs);
  timer.unref?.();
  // Kick an immediate first pass so a file already present at boot is picked up.
  void tick();
}
