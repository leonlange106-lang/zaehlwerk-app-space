import { checkForUpdates } from "@zaehlwerk/updater";
import { NOT_DELETED, prisma } from "@zaehlwerk/database";
import { getRepoRoot, getRunningBuildSha } from "./version";
import { branchFallbackAllowed, REPO_NAME, REPO_OWNER, resolveUpdateTarget } from "./update-target";
import { getBackupPolicy, getLogRetentionPolicy } from "./settings";
import {
  buildNotifications,
  pruneReadIds,
  sortNotifications,
  unreadCount,
  type NotificationItem,
} from "./notifications";

// The IO half of the notification bell: gather the conditions, read and write
// the per-user read markers. The rules themselves live in notifications.ts and
// know nothing about any of this.

/**
 * Read markers live in the existing Setting store, one row per user.
 *
 * Deliberately not a new Prisma model: Paket F is specified to need no schema
 * change (a schema change only takes effect after a self-update, which is why
 * everything needing one is grouped into Paket G). Notifications are derived,
 * so the only thing that must persist is which ids this person has already
 * seen — a short JSON array, pruned to the live conditions on every write.
 */
function readKey(userId: string): string {
  return `notifications.read.${userId}`;
}

/**
 * The update check reaches GitHub, so it is the slow and failure-prone source.
 *
 * A short cache keeps the bell from making a network round-trip on every page
 * load — the bell is in the header, i.e. on every page — while still noticing a
 * new release within the hour. In-memory on purpose: it is a cache, and losing
 * it when the container is recreated costs one extra request.
 */
const UPDATE_CACHE_MS = 10 * 60 * 1000;
let updateCache: { at: number; value: { available: boolean; label: string | null } | null } | null =
  null;

async function checkUpdate(): Promise<{ available: boolean; label: string | null } | null> {
  if (updateCache && Date.now() - updateCache.at < UPDATE_CACHE_MS) return updateCache.value;

  let value: { available: boolean; label: string | null } | null = null;
  try {
    const target = await resolveUpdateTarget();
    const result = await checkForUpdates({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      branch: process.env.UPDATE_BRANCH ?? "main",
      channel: target.channel,
      allowBranchFallback: branchFallbackAllowed(),
      currentSha: getRunningBuildSha(),
      cwd: getRepoRoot(),
    });
    // `comparisonUnavailable` means GitHub could not compare the commits, and
    // `updateAvailable` then degrades to "the SHAs differ" — which cannot tell an
    // update from a downgrade. Announcing that as an available update would be a
    // guess, so this source stays silent instead.
    value = result.comparisonUnavailable
      ? null
      : {
          available: result.updateAvailable,
          label: result.latestRelease?.tagName ?? result.latestShortSha ?? null,
        };
  } catch {
    // GitHub unreachable, no token, rate-limited. Not news for the bell — it
    // would fire on every network blip and mean nothing.
    value = null;
  }

  updateCache = { at: Date.now(), value };
  return value;
}

/** Everything the bell has to say to this user, newest conditions first. */
export async function listNotifications(
  userId: string,
  { allowedAppIds }: { allowedAppIds: string[] } = { allowedAppIds: [] },
): Promise<{ items: NotificationItem[]; unread: number }> {
  const [update, backup, retention, readIds, meters, ingestion] = await Promise.all([
    checkUpdate(),
    getBackupPolicy(),
    getLogRetentionPolicy(),
    readMarkers(userId),
    // A due-reading notice names a meter. Offering it to an account without the
    // Zählwerk app would tell it that meter exists — the same information leak
    // the search route guards against, arriving through the bell instead.
    allowedAppIds.includes("zaehlwerk") ? dueReadingSources() : Promise.resolve([]),
    allowedAppIds.includes("log-analyzer")
      ? ingestionSource()
      : Promise.resolve({ expectedWithinHours: 0, lastIngestAt: null }),
  ]);

  const items = sortNotifications(
    buildNotifications({
      update,
      backup: {
        autoEnabled: backup.autoEnabled,
        intervalHours: backup.intervalHours,
        lastRunAt: backup.lastRunAt,
      },
      maintenance: {
        lastRunAt: await readMaintenanceRun(),
        // Both retention limits default to 0 = unlimited. With neither set the
        // maintenance sweep has nothing to do, so it cannot be overdue.
        enabled: retention.retentionDays > 0 || retention.maxCount > 0,
      },
      meters,
      ingestion,
      now: new Date(),
    }),
  );

  return { items, unread: unreadCount(items, readIds) };
}

/**
 * Meters that ask to be read on a schedule, with their newest reading.
 *
 * Only meters with an interval are fetched — the column defaults to 0 ("no
 * reminder"), so this stays empty on an instance that never configured one
 * rather than reading every meter on every poll.
 */
async function dueReadingSources(): Promise<
  { id: string; name: string; intervalDays: number; lastReadingAt: string | null }[]
> {
  const rows = await prisma.zaehler.findMany({
    where: { aktiv: true, ableseIntervallTage: { gt: 0 } },
    select: {
      id: true,
      name: true,
      ableseIntervallTage: true,
      // Eine geloeschte Ablesung darf die Erinnerung nicht stillhalten: Sonst
      // gilt ein Zaehler als kuerzlich abgelesen, obwohl der Stand fort ist.
      ablesungen: {
        where: NOT_DELETED,
        orderBy: { datum: "desc" },
        take: 1,
        select: { datum: true },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    intervalDays: row.ableseIntervallTage,
    lastReadingAt: row.ablesungen[0]?.datum.toISOString() ?? null,
  }));
}

/**
 * When did an automated import last land, and how often is one expected?
 *
 * The expectation is opt-in (`logs.ingestExpectedHours`, 0 = off) for the same
 * reason every other limit here is: an instance that uploads by hand must not be
 * told its imports stopped. "Automated" is `source != "upload"` — the column the
 * ingestion path already sets.
 */
async function ingestionSource(): Promise<{
  expectedWithinHours: number;
  lastIngestAt: string | null;
}> {
  const [setting, latest] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "logs.ingestExpectedHours" } }),
    prisma.logFile.findFirst({
      where: { source: { not: "upload" } },
      orderBy: { createdAt: "desc" },
      // Never select `csv` — the largest column in the database, for a timestamp.
      select: { createdAt: true },
    }),
  ]);
  const hours = Number.parseInt(setting?.value ?? "0", 10);
  return {
    expectedWithinHours: Number.isFinite(hours) && hours > 0 ? hours : 0,
    lastIngestAt: latest?.createdAt.toISOString() ?? null,
  };
}

async function readMaintenanceRun(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: "maintenance.lastRunAt" } });
  return row?.value ?? null;
}

async function readMarkers(userId: string): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: readKey(userId) } });
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Mark everything currently shown as read.
 *
 * The ids come from a fresh derivation rather than from the request, so a client
 * cannot mark an id that is not actually live — and the stored list is pruned to
 * the live conditions, which is what bounds its growth.
 */
export async function markAllRead(
  userId: string,
  options?: { allowedAppIds: string[] },
): Promise<{ unread: number }> {
  const { items } = await listNotifications(userId, options);
  const ids = pruneReadIds(items, items.map((item) => item.id));
  const value = JSON.stringify(ids);
  await prisma.setting.upsert({
    where: { key: readKey(userId) },
    create: { key: readKey(userId), value },
    update: { value },
  });
  return { unread: 0 };
}

/** Test seam: drop the cached update check so a test need not wait it out. */
export function resetUpdateCache(): void {
  updateCache = null;
}
