import { describe, expect, it } from "vitest";
import {
  buildNotifications,
  pruneReadIds,
  sortNotifications,
  unreadCount,
  type NotificationSources,
} from "./notifications";

const NOW = new Date("2026-07-26T12:00:00.000Z");

function sources(patch: Partial<NotificationSources> = {}): NotificationSources {
  return {
    update: null,
    backup: { autoEnabled: false, intervalHours: 24, lastRunAt: null },
    maintenance: { lastRunAt: null, enabled: false },
    meters: [],
    ingestion: { expectedWithinHours: 0, lastIngestAt: null },
    now: NOW,
    ...patch,
  };
}

const idsOf = (items: { id: string }[]) => items.map((item) => item.id);

describe("buildNotifications", () => {
  it("says nothing when everything is fine", () => {
    // A bell that always has something in it is a bell nobody looks at.
    expect(buildNotifications(sources())).toEqual([]);
  });

  describe("update available", () => {
    it("reports one when the check found a newer version", () => {
      const items = buildNotifications(
        sources({ update: { available: true, label: "v3.2.0" } }),
      );
      expect(idsOf(items)).toEqual(["update:v3.2.0"]);
      expect(items[0].href).toBe("/settings/system");
    });

    it("says nothing when the check found none", () => {
      expect(buildNotifications(sources({ update: { available: false, label: null } }))).toEqual([]);
    });

    it("says nothing when the check could not run", () => {
      // GitHub being unreachable is not news for the bell — it would fire on
      // every network blip and mean nothing.
      expect(buildNotifications(sources({ update: null }))).toEqual([]);
    });

    it("keys the id on the version, so dismissing one does not silence the next", () => {
      const first = buildNotifications(sources({ update: { available: true, label: "v3.2.0" } }));
      const second = buildNotifications(sources({ update: { available: true, label: "v3.3.0" } }));
      expect(first[0].id).not.toBe(second[0].id);
      // …and stays stable while the same version is still on offer, or
      // dismissing it would bring it straight back.
      const again = buildNotifications(sources({ update: { available: true, label: "v3.2.0" } }));
      expect(again[0].id).toBe(first[0].id);
    });
  });

  describe("backup", () => {
    it("stays quiet when automatic backup is switched off", () => {
      // Off is a decision, not a fault. Reporting it trains people to ignore
      // the bell — even when the last run is ancient.
      const items = buildNotifications(
        sources({
          backup: { autoEnabled: false, intervalHours: 24, lastRunAt: "2020-01-01T00:00:00.000Z" },
        }),
      );
      expect(items).toEqual([]);
    });

    it("reports an enabled backup that has never run", () => {
      const items = buildNotifications(
        sources({ backup: { autoEnabled: true, intervalHours: 24, lastRunAt: null } }),
      );
      expect(idsOf(items)).toEqual(["backup:never"]);
      expect(items[0].tone).toBe("watch");
    });

    it("tolerates one interval of drift", () => {
      // The scheduler runs on a timer; being a bit late is normal operation,
      // not an incident.
      const items = buildNotifications(
        sources({
          backup: {
            autoEnabled: true,
            intervalHours: 24,
            lastRunAt: new Date(NOW.getTime() - 30 * 60 * 60 * 1000).toISOString(),
          },
        }),
      );
      expect(items).toEqual([]);
    });

    it("reports a missed cycle as a risk", () => {
      const items = buildNotifications(
        sources({
          backup: {
            autoEnabled: true,
            intervalHours: 24,
            lastRunAt: new Date(NOW.getTime() - 72 * 60 * 60 * 1000).toISOString(),
          },
        }),
      );
      expect(items).toHaveLength(1);
      expect(items[0].tone).toBe("risk");
      expect(items[0].body).toContain("3 Tagen");
    });

    it("keeps the id stable within a day so dismissing it sticks", () => {
      // An id derived from the raw timestamp would change every minute, and the
      // item would pop back up as unread just after being dismissed.
      const lastRunAt = new Date(NOW.getTime() - 72 * 60 * 60 * 1000).toISOString();
      const morning = buildNotifications(
        sources({ backup: { autoEnabled: true, intervalHours: 24, lastRunAt } }),
      );
      const anHourLater = buildNotifications(
        sources({
          backup: { autoEnabled: true, intervalHours: 24, lastRunAt },
          now: new Date(NOW.getTime() + 60 * 60 * 1000),
        }),
      );
      expect(morning[0].id).toBe(anHourLater[0].id);
    });

    it("scales the threshold with the configured interval", () => {
      // Six hours late is overdue for an hourly backup and fine for a daily one.
      const lastRunAt = new Date(NOW.getTime() - 6 * 60 * 60 * 1000).toISOString();
      expect(
        buildNotifications(sources({ backup: { autoEnabled: true, intervalHours: 1, lastRunAt } })),
      ).toHaveLength(1);
      expect(
        buildNotifications(sources({ backup: { autoEnabled: true, intervalHours: 24, lastRunAt } })),
      ).toHaveLength(0);
    });
  });

  describe("maintenance", () => {
    it("stays quiet when no retention limit is configured", () => {
      // Both limits default to 0 = unlimited; an instance that never opted in
      // cannot be overdue for something it does not do.
      expect(
        buildNotifications(
          sources({ maintenance: { enabled: false, lastRunAt: "2020-01-01T00:00:00.000Z" } }),
        ),
      ).toEqual([]);
    });

    it("reports a missed sweep once retention is on", () => {
      const items = buildNotifications(
        sources({
          maintenance: {
            enabled: true,
            lastRunAt: new Date(NOW.getTime() - 72 * 60 * 60 * 1000).toISOString(),
          },
        }),
      );
      expect(items).toHaveLength(1);
      expect(items[0].id).toContain("maintenance:overdue");
    });

    it("does not report an enabled policy that has simply never run yet", () => {
      // Turning retention on and looking at the bell a second later must not
      // accuse the scheduler of being late.
      expect(
        buildNotifications(sources({ maintenance: { enabled: true, lastRunAt: null } })),
      ).toEqual([]);
    });
  });

  it("reports several conditions at once", () => {
    const items = buildNotifications(
      sources({
        update: { available: true, label: "v3.2.0" },
        backup: { autoEnabled: true, intervalHours: 24, lastRunAt: null },
        maintenance: {
          enabled: true,
          lastRunAt: new Date(NOW.getTime() - 100 * 60 * 60 * 1000).toISOString(),
        },
      }),
    );
    expect(items).toHaveLength(3);
  });
});

describe("readings due", () => {
  const meter = (patch: Partial<NotificationSources["meters"][number]> = {}) => ({
    id: "m1",
    name: "Strom Hauptzähler",
    intervalDays: 30,
    lastReadingAt: new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    ...patch,
  });

  it("reports a meter past its interval", () => {
    const items = buildNotifications(sources({ meters: [meter()] }));
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("Strom Hauptzähler");
    expect(items[0].href).toBe("/apps/zaehlwerk/zaehler/m1");
  });

  it("ignores a meter with no interval configured", () => {
    // The column defaults to 0. A reminder nobody asked for is a nuisance, and
    // it costs the bell the attention its real messages need.
    expect(buildNotifications(sources({ meters: [meter({ intervalDays: 0 })] }))).toEqual([]);
  });

  it("does not fire before the interval is up", () => {
    // No grace factor here, unlike the scheduled jobs: this is the interval a
    // person asked to be reminded of, and doubling it silently would make a
    // 30-day interval fire after 60.
    const items = buildNotifications(
      sources({
        meters: [
          meter({ lastReadingAt: new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString() }),
        ],
      }),
    );
    expect(items).toEqual([]);
  });

  it("fires the day after the interval elapses", () => {
    const items = buildNotifications(
      sources({
        meters: [
          meter({ lastReadingAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString() }),
        ],
      }),
    );
    expect(items).toHaveLength(1);
  });

  it("says nothing about a meter that was never read", () => {
    // That is a meter someone just created, not an overdue one. Nagging the
    // moment it exists is how a bell loses its audience.
    expect(buildNotifications(sources({ meters: [meter({ lastReadingAt: null })] }))).toEqual([]);
  });

  it("keys the id on the reading it is waiting for", () => {
    // Entering a reading must end the item; a later overdue period is new.
    const first = buildNotifications(sources({ meters: [meter()] }))[0];
    const afterReading = buildNotifications(
      sources({
        meters: [
          meter({ lastReadingAt: new Date(NOW.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString() }),
        ],
      }),
    )[0];
    expect(first.id).not.toBe(afterReading.id);
  });

  it("reports each overdue meter separately", () => {
    const items = buildNotifications(
      sources({ meters: [meter(), meter({ id: "m2", name: "Gas" })] }),
    );
    expect(items).toHaveLength(2);
  });
});

describe("ingestion gone quiet", () => {
  it("says nothing when no expectation is configured", () => {
    // The normal state for an instance that uploads by hand. Telling it that
    // its imports stopped would be telling it about something it never had.
    expect(
      buildNotifications(
        sources({ ingestion: { expectedWithinHours: 0, lastIngestAt: null } }),
      ),
    ).toEqual([]);
  });

  it("reports an expectation that has never been met", () => {
    const items = buildNotifications(
      sources({ ingestion: { expectedWithinHours: 24, lastIngestAt: null } }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("ingestion:never");
    expect(items[0].href).toBe("/settings/integrationen");
  });

  it("stays quiet while imports keep arriving", () => {
    expect(
      buildNotifications(
        sources({
          ingestion: {
            expectedWithinHours: 24,
            lastIngestAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString(),
          },
        }),
      ),
    ).toEqual([]);
  });

  it("reports the silence once the window has passed", () => {
    // This is the answer to § 6.4: a push path fails silently, and the one real
    // advantage a crawler had was that you did not have to remember.
    const items = buildNotifications(
      sources({
        ingestion: {
          expectedWithinHours: 24,
          lastIngestAt: new Date(NOW.getTime() - 72 * 60 * 60 * 1000).toISOString(),
        },
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("verstummt");
    expect(items[0].body).toContain("3 Tagen");
  });
});

describe("sortNotifications", () => {
  it("puts the serious ones first", () => {
    const sorted = sortNotifications(
      buildNotifications(
        sources({
          update: { available: true, label: "v3.2.0" },
          backup: {
            autoEnabled: true,
            intervalHours: 24,
            lastRunAt: new Date(NOW.getTime() - 72 * 60 * 60 * 1000).toISOString(),
          },
        }),
      ),
    );
    expect(sorted.map((item) => item.tone)).toEqual(["risk", "neutral"]);
  });
});

describe("unreadCount", () => {
  const items = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
  ] as Parameters<typeof unreadCount>[0];

  it("counts what has not been marked read", () => {
    expect(unreadCount(items, [])).toBe(3);
    expect(unreadCount(items, ["a"])).toBe(2);
    expect(unreadCount(items, ["a", "b", "c"])).toBe(0);
  });

  it("ignores markers for conditions that are gone", () => {
    expect(unreadCount(items, ["gone", "a"])).toBe(2);
  });
});

describe("pruneReadIds", () => {
  it("keeps only markers whose condition is still live", () => {
    // Otherwise the marker list grows forever — every version ever offered,
    // every day a backup was late — inside one Setting row.
    const items = [{ id: "update:v3.2.0" }, { id: "backup:never" }] as Parameters<
      typeof pruneReadIds
    >[0];
    expect(pruneReadIds(items, ["update:v3.1.0", "update:v3.2.0", "stale"])).toEqual([
      "update:v3.2.0",
    ]);
  });

  it("returns nothing when every condition has cleared", () => {
    expect(pruneReadIds([], ["a", "b"])).toEqual([]);
  });
});
