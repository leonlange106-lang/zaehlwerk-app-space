// What the bell in the header has to say. Pure and framework-free — no Prisma,
// no React — so the rules for "is this worth telling someone" are the unit-test
// surface rather than something only reproducible by letting a backup fail.
//
// **These are DERIVED, not stored.** Every item below is a conclusion about
// state the platform already keeps: the update check, the backup policy and its
// snapshots, the maintenance timestamp. Nothing writes a notification row, which
// is why this package needs no schema change — only the read markers are
// persisted, and those fit the existing Setting store.
//
// The consequence to keep in mind: an item disappears when its cause is gone. A
// backup that failed and then succeeded stops being news, which is right — the
// bell reports the present, not a history. `lib/audit.ts` is the history.

export type NotificationTone = "risk" | "watch" | "neutral";

export interface NotificationItem {
  /**
   * Stable across renders AND across the cause persisting.
   *
   * This is what a read marker points at, so it must not change while the
   * underlying condition is unchanged — otherwise dismissing an item brings it
   * straight back under a new id. It MUST change when the condition changes
   * (a newer version appears, a later backup fails), or dismissing it once
   * would silence the next one too.
   */
  id: string;
  tone: NotificationTone;
  title: string;
  body: string;
  /** Where to go to act on it. */
  href: string;
  /** ISO. When the condition was last observed to be true. */
  at: string;
}

export interface NotificationSources {
  /** Result of the channel-aware update check, or null when it could not run. */
  update: { available: boolean; label: string | null } | null;
  backup: {
    autoEnabled: boolean;
    intervalHours: number;
    /** ISO of the last successful automatic run, or null if never. */
    lastRunAt: string | null;
  };
  maintenance: {
    /** ISO of the last maintenance sweep, or null if never. */
    lastRunAt: string | null;
    /** Whether any retention limit is switched on at all. */
    enabled: boolean;
  };
  /**
   * Meters with a reading interval set, and when they were last read.
   *
   * Phase 2 of § 7.2, and the reason it waited for this package: the interval is
   * a column on the meter, so it needed the same migration as the vehicles.
   */
  meters: { id: string; name: string; intervalDays: number; lastReadingAt: string | null }[];
  /** Injected so the rules are testable without freezing the clock globally. */
  now: Date;
}

/**
 * How late a scheduled job may be before it is worth interrupting someone.
 *
 * One interval late is not news — the scheduler runs on a timer and a few
 * minutes of drift is normal operation. Two full intervals means it has missed
 * a run, which is a real condition with a real cause (a container that did not
 * come back up, a full disk — the recurring failure here).
 */
const OVERDUE_FACTOR = 2;

/** Maintenance runs daily; the same "missed a whole cycle" rule applies. */
const MAINTENANCE_INTERVAL_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return (now.getTime() - then) / HOUR_MS;
}

function formatHours(hours: number): string {
  if (hours < 48) return `${Math.floor(hours)} Stunden`;
  return `${Math.floor(hours / 24)} Tagen`;
}

export function buildNotifications(sources: NotificationSources): NotificationItem[] {
  const items: NotificationItem[] = [];
  const nowIso = sources.now.toISOString();

  // 1) An update is available.
  if (sources.update?.available) {
    const label = sources.update.label ?? "neue Version";
    items.push({
      // Keyed by the VERSION: dismissing "3.1.0 is available" must not also
      // silence 3.2.0, and re-checking while still on 3.0.0 must not resurrect it.
      id: `update:${label}`,
      tone: "neutral",
      title: "Update verfügbar",
      body: `${label} steht bereit. Der Stand wird beim Einspielen gebaut und getestet.`,
      href: "/settings/system",
      at: nowIso,
    });
  }

  // 2) The automatic backup has missed a cycle.
  //
  // Only when it is switched ON: a disabled backup is a decision, not a fault,
  // and reporting it would train people to ignore the bell.
  if (sources.backup.autoEnabled) {
    const elapsed = hoursSince(sources.backup.lastRunAt, sources.now);
    const limit = Math.max(1, sources.backup.intervalHours) * OVERDUE_FACTOR;
    if (elapsed === null) {
      items.push({
        id: "backup:never",
        tone: "watch",
        title: "Noch kein automatisches Backup",
        body: "Die automatische Sicherung ist aktiv, hat aber noch nie gelaufen.",
        href: "/settings/daten",
        at: nowIso,
      });
    } else if (elapsed > limit) {
      items.push({
        // Bucketed by day, not by the raw timestamp: an id that moved every
        // minute would reappear as unread a minute after being dismissed, while
        // the condition still genuinely worsens day by day.
        id: `backup:overdue:${sources.backup.lastRunAt?.slice(0, 10)}`,
        tone: "risk",
        title: "Automatisches Backup überfällig",
        body: `Die letzte Sicherung liegt ${formatHours(elapsed)} zurück, geplant ist alle ${sources.backup.intervalHours} Stunden.`,
        href: "/settings/daten",
        at: nowIso,
      });
    }
  }

  // 3) Maintenance (retention + VACUUM) has missed a cycle.
  //
  // Again only when retention is actually configured — both limits default to
  // 0 = unlimited, and an instance that never opted in is not overdue.
  if (sources.maintenance.enabled) {
    const elapsed = hoursSince(sources.maintenance.lastRunAt, sources.now);
    if (elapsed !== null && elapsed > MAINTENANCE_INTERVAL_HOURS * OVERDUE_FACTOR) {
      items.push({
        id: `maintenance:overdue:${sources.maintenance.lastRunAt?.slice(0, 10)}`,
        tone: "watch",
        title: "Wartung überfällig",
        body: `Aufräumen und Verdichten liefen zuletzt vor ${formatHours(elapsed)}. Ohne sie wächst die Datenbank unbegrenzt.`,
        href: "/settings/daten",
        at: nowIso,
      });
    }
  }

  // 4) A meter is overdue for a reading.
  //
  // Unlike the jobs above this is a HUMAN task, so there is no grace factor:
  // the interval is what the person asked to be reminded of, and doubling it
  // silently would make a 30-day interval fire after 60. A meter with interval
  // 0 has no reminder configured and is skipped entirely.
  for (const meter of sources.meters) {
    if (meter.intervalDays <= 0) continue;
    const elapsed = hoursSince(meter.lastReadingAt, sources.now);
    // Never read at all is not "overdue" — it is a meter someone just created.
    // Nagging about it the moment it exists is how a bell loses its audience.
    if (elapsed === null) continue;
    const dueAfterHours = meter.intervalDays * 24;
    if (elapsed <= dueAfterHours) continue;

    items.push({
      // Keyed by meter AND by the reading it is waiting on, so entering a
      // reading ends this item and a later overdue period is a new one.
      id: `reading:${meter.id}:${meter.lastReadingAt?.slice(0, 10)}`,
      tone: "watch",
      title: `Ablesung fällig: ${meter.name}`,
      body: `Zuletzt vor ${formatHours(elapsed)} abgelesen, vorgesehen ist alle ${meter.intervalDays} Tage.`,
      href: `/apps/zaehlwerk/zaehler/${meter.id}`,
      at: nowIso,
    });
  }

  return items;
}

/** Risk first, then watch, then neutral — the order they should be read in. */
const TONE_RANK: Record<NotificationTone, number> = { risk: 0, watch: 1, neutral: 2 };

export function sortNotifications(items: NotificationItem[]): NotificationItem[] {
  return [...items].sort(
    (a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || a.title.localeCompare(b.title, "de-DE"),
  );
}

/**
 * Which of these has the reader not seen?
 *
 * Read markers are ids, not a timestamp watermark. A watermark would mark
 * everything older as read the moment one item is dismissed — including a
 * different, more serious condition that happened to be observed earlier.
 */
export function unreadCount(items: NotificationItem[], readIds: string[]): number {
  const read = new Set(readIds);
  return items.filter((item) => !read.has(item.id)).length;
}

/**
 * Drop markers whose condition no longer exists.
 *
 * Without this the marker list grows forever — every version ever offered, every
 * day a backup was late — in a single Setting row. Keeping only the markers that
 * still match a live item bounds it by the number of active conditions.
 */
export function pruneReadIds(items: NotificationItem[], readIds: string[]): string[] {
  const live = new Set(items.map((item) => item.id));
  return readIds.filter((id) => live.has(id));
}
