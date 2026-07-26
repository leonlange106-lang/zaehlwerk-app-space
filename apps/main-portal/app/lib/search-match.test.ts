import { describe, expect, it } from "vitest";
import {
  caseVariants,
  foldForCompare,
  isSearchable,
  matchStaticTargets,
  normalizeQuery,
  rankHits,
  scoreMatch,
  type StaticTarget,
} from "./search-match";
import { STATIC_SEARCH_TARGETS } from "./search-targets";

const ALL_APPS = ["zaehlwerk", "log-analyzer"];

describe("normalizeQuery / isSearchable", () => {
  it("trims and caps the length", () => {
    expect(normalizeQuery("  Zähler  ")).toBe("Zähler");
    expect(normalizeQuery("x".repeat(200))).toHaveLength(64);
  });

  it("refuses a query too short to mean anything", () => {
    // A single character matches most of the corpus — running that query is
    // work for a list nobody can use.
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("a")).toBe(false);
    expect(isSearchable(" a ")).toBe(false);
    expect(isSearchable("ab")).toBe(true);
  });
});

describe("caseVariants", () => {
  it("returns exactly one clause for an all-ASCII term", () => {
    // SQLite's LIKE already folds ASCII case, so extra variants here would be
    // dead OR-branches paid for on every query.
    expect(caseVariants("log")).toEqual(["log"]);
    expect(caseVariants("BACKUP")).toEqual(["BACKUP"]);
  });

  it("covers the umlaut cases LIKE cannot fold", () => {
    // This is why the function exists: SQLite folds ASCII only, so a lowercase
    // "ä" never matches a stored "Ä" without being asked for explicitly.
    const variants = caseVariants("zähler");
    expect(variants).toContain("zähler");
    expect(variants).toContain("ZÄHLER");
    expect(variants).toContain("Zähler");
  });

  it("never emits duplicates", () => {
    for (const term of ["log", "LOG", "Log", "zähler", "ÖL"]) {
      expect(new Set(caseVariants(term)).size).toBe(caseVariants(term).length);
    }
  });
});

describe("foldForCompare", () => {
  it("flattens case and German umlauts alike", () => {
    expect(foldForCompare("Zähler")).toBe("zaehler");
    expect(foldForCompare("GRÖSSE")).toBe("groesse");
    expect(foldForCompare("Straße")).toBe("strasse");
  });

  it("makes an umlaut and its transliteration match", () => {
    // Someone typing "zaehler" on a keyboard without umlauts must still find it.
    expect(foldForCompare("Zähler")).toBe(foldForCompare("zaehler"));
  });
});

describe("scoreMatch", () => {
  it("ranks exact above prefix above word-start above substring", () => {
    expect(scoreMatch("Backup", "Backup")).toBeGreaterThan(scoreMatch("Backup-Plan", "Backup"));
    expect(scoreMatch("Backup-Plan", "Backup")).toBeGreaterThan(
      scoreMatch("System Backup Plan", "Backup"),
    );
    expect(scoreMatch("System Backup Plan", "Backup")).toBeGreaterThan(
      scoreMatch("Xbackupx", "Backup"),
    );
  });

  it("finds a word inside a multi-word title", () => {
    expect(scoreMatch("Virtueller Prüfstand", "prüf")).toBeGreaterThan(0);
    expect(scoreMatch("Virtueller Prüfstand", "pruef")).toBeGreaterThan(0);
  });

  it("returns 0 for no match and for empty input", () => {
    expect(scoreMatch("Zähler", "Motor")).toBe(0);
    expect(scoreMatch("", "Motor")).toBe(0);
    expect(scoreMatch("Zähler", "")).toBe(0);
  });

  it("treats a regex metacharacter as literal text", () => {
    // A term like "c++" or "(" must not blow up the word-boundary probe.
    expect(() => scoreMatch("Version 1.0 (beta)", "(beta")).not.toThrow();
    expect(scoreMatch("Version 1.0 (beta)", "(beta")).toBeGreaterThan(0);
  });
});

const TARGETS: StaticTarget[] = [
  { kind: "page", id: "a", title: "Zähler", href: "/z", appId: "zaehlwerk" },
  { kind: "page", id: "b", title: "Log-Vergleich", href: "/l", appId: "log-analyzer" },
  { kind: "settings", id: "c", title: "Daten & Backup", href: "/s", topics: ["Sicherung"], adminOnly: true },
  { kind: "settings", id: "d", title: "Sicherheit & Zugriff", href: "/x", topics: ["2FA"] },
];

describe("matchStaticTargets", () => {
  it("hides a target from an app the user may not use", () => {
    // The information leak this exists to prevent: a hit names data the account
    // is not allowed to know exists — the same lesson as AUDIT.md § 4.1.
    const hits = matchStaticTargets(TARGETS, "Zähler", {
      allowedAppIds: ["log-analyzer"],
      isAdmin: false,
    });
    expect(hits).toHaveLength(0);
  });

  it("shows it once the app is allowed", () => {
    const hits = matchStaticTargets(TARGETS, "Zähler", {
      allowedAppIds: ALL_APPS,
      isAdmin: false,
    });
    expect(hits.map((hit) => hit.id)).toEqual(["a"]);
  });

  it("hides an admin-only target from a normal user", () => {
    expect(
      matchStaticTargets(TARGETS, "Backup", { allowedAppIds: ALL_APPS, isAdmin: false }),
    ).toHaveLength(0);
    expect(
      matchStaticTargets(TARGETS, "Backup", { allowedAppIds: ALL_APPS, isAdmin: true }),
    ).toHaveLength(1);
  });

  it("finds a target through its topics", () => {
    const hits = matchStaticTargets(TARGETS, "2FA", { allowedAppIds: [], isAdmin: false });
    expect(hits.map((hit) => hit.id)).toEqual(["d"]);
  });

  it("ranks a title match above a topic match", () => {
    const targets: StaticTarget[] = [
      { kind: "settings", id: "topic", title: "System & Update", href: "/1", topics: ["Backup"] },
      { kind: "settings", id: "title", title: "Backup", href: "/2" },
    ];
    const hits = matchStaticTargets(targets, "Backup", { allowedAppIds: [], isAdmin: true });
    expect(hits[0]?.id, "the group actually called Backup must come first").toBe("title");
  });

  it("returns nothing for a query too short to run", () => {
    expect(matchStaticTargets(TARGETS, "a", { allowedAppIds: ALL_APPS, isAdmin: true })).toEqual([]);
  });
});

describe("rankHits", () => {
  it("breaks score ties on the title, so the order is never arbitrary", () => {
    const ranked = rankHits([
      { kind: "page", id: "1", title: "Berichte", href: "/b", score: 40 },
      { kind: "page", id: "2", title: "Analyzer", href: "/a", score: 40 },
      { kind: "page", id: "3", title: "Zähler", href: "/z", score: 75 },
    ]);
    expect(ranked.map((hit) => hit.title)).toEqual(["Zähler", "Analyzer", "Berichte"]);
  });
});

describe("the shipped target list", () => {
  it("gives every target a unique id", () => {
    const ids = STATIC_SEARCH_TARGETS.map((target) => target.id);
    expect(new Set(ids).size, "duplicate ids collapse into one React key").toBe(ids.length);
  });

  it("tags every app section with the app it belongs to", () => {
    // An app section without `appId` is visible to everyone — the exact leak the
    // access filter exists to prevent, and easy to introduce by adding a row.
    for (const target of STATIC_SEARCH_TARGETS) {
      if (target.href.startsWith("/apps/")) {
        expect(target.appId, `${target.href} must name its app`).toBeTruthy();
      }
    }
  });

  it("offers every settings group", () => {
    const slugs = STATIC_SEARCH_TARGETS.filter((target) => target.kind === "settings").map(
      (target) => target.href,
    );
    expect(slugs).toContain("/settings/sicherheit");
    expect(slugs).toContain("/settings/system");
    expect(slugs).toHaveLength(5);
  });

  it("finds the settings group for words that are not in its title", () => {
    // The point of `topics`: nobody looking for their backup knows it is filed
    // under "Daten".
    const found = (term: string) =>
      matchStaticTargets(STATIC_SEARCH_TARGETS, term, {
        allowedAppIds: ALL_APPS,
        isAdmin: true,
      })[0]?.href;

    expect(found("Backup")).toBe("/settings/daten");
    expect(found("Rollback")).toBe("/settings/system");
    expect(found("TOTP")).toBe("/settings/sicherheit");
    expect(found("Rollen")).toBe("/settings/benutzer");
  });

  it("finds an app section by a word it does not contain", () => {
    const hits = matchStaticTargets(STATIC_SEARCH_TARGETS, "Dyno", {
      allowedAppIds: ALL_APPS,
      isAdmin: false,
    });
    expect(hits[0]?.href).toBe("/apps/log-analyzer/dyno");
  });
});
