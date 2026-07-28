import { APPS } from "./apps";
import { SETTINGS_GROUPS, settingsGroupHref } from "@/app/settings/groups";
import { ADMIN_SECTIONS, adminSectionHref } from "@/app/apps/admin/sections";
import type { StaticTarget } from "./search-match";

// Every destination the search can offer that is known without touching the
// database: the app sections the navigation menu lists, and the settings groups.
//
// Derived from the SAME registries the menu renders from — `APPS` and
// `SETTINGS_GROUPS` — rather than retyped here. A section that exists in the
// menu but not in search is the failure mode this avoids, and it is the reason
// the settings groups carry their `topics` next to their route instead of in a
// search-only table.

const APP_SECTION_TARGETS: StaticTarget[] = [
  // Zählwerk
  section("zaehlwerk", "Dashboard", "/apps/zaehlwerk", ["Übersicht", "Verbrauch", "Kosten"]),
  section("zaehlwerk", "Zähler", "/apps/zaehlwerk/zaehler", ["Messgerät", "Strom", "Gas", "Wasser"]),
  section("zaehlwerk", "Berichte", "/apps/zaehlwerk/berichte", ["Report", "PDF", "CSV", "Export", "Jahresübersicht"]),
  section("zaehlwerk", "App-Einstellungen", "/apps/zaehlwerk/einstellungen", ["Standorte", "Tarife", "Kategorien"]),
  // Log Analyzer
  section("log-analyzer", "Analyzer", "/apps/log-analyzer", ["Auswertung", "Log", "Datenlog", "Pull"]),
  section("log-analyzer", "Log-Vergleich", "/apps/log-analyzer/compare", ["Vergleich", "Overlay", "Delta", "Base"]),
  section("log-analyzer", "Virtueller Prüfstand", "/apps/log-analyzer/dyno", ["Dyno", "Leistung", "PS", "Drehmoment", "Leistungsschätzung"]),
  section("log-analyzer", "Remote-Import", "/apps/log-analyzer/remote", ["Import", "URL", "Herunterladen"]),
  section("log-analyzer", "Fahrzeug-Profil", "/apps/log-analyzer/specs", ["Fahrzeug", "Motor", "Spezifikation", "Grenzwerte"]),
  section("log-analyzer", "Log-Übersicht", "/apps/log-analyzer/history", ["Historie", "Gespeicherte Logs", "Verlauf"]),
];

function section(appId: string, title: string, href: string, topics: string[]): StaticTarget {
  const app = APPS.find((candidate) => candidate.id === appId);
  return {
    kind: "page",
    id: `page:${href}`,
    title,
    subtitle: app?.name,
    href,
    topics,
    appId,
  };
}

const PLATFORM_TARGETS: StaticTarget[] = [
  {
    kind: "page",
    id: "page:/",
    title: "App Space",
    subtitle: "Startseite",
    href: "/",
    topics: ["Start", "Launcher", "Übersicht", "Apps"],
    appId: null,
  },
  {
    kind: "page",
    id: "page:/changelog",
    title: "Changelog",
    subtitle: "Was sich zuletzt geändert hat",
    href: "/changelog",
    // The changelog's own ENTRIES are deliberately not searched here: they are
    // fetched live from the GitHub API, so indexing them would mean a network
    // round-trip per keystroke, and a search that fails when GitHub is slow.
    // The changelog page carries its own filter and search, which is where
    // searching commit messages belongs. This entry gets you there.
    topics: ["Versionen", "Commits", "Neuerungen", "Release Notes"],
    appId: null,
  },
  {
    kind: "page",
    id: "page:/settings",
    title: "Plattform-Einstellungen",
    subtitle: "Alle Bereiche",
    href: "/settings",
    topics: ["Einstellungen", "Konfiguration", "System"],
    appId: null,
  },
];

const SETTINGS_TARGETS: StaticTarget[] = SETTINGS_GROUPS.map((group) => ({
  kind: "settings",
  id: `settings:${group.slug}`,
  title: group.title,
  subtitle: group.description,
  href: settingsGroupHref(group),
  topics: group.topics,
  appId: null,
  adminOnly: group.adminOnly,
}));

// Nur fuer Admins — `adminOnly` filtert sie in matchStaticTargets heraus, damit
// ein Suchtreffer nicht verraet, dass es diesen Bereich ueberhaupt gibt.
const ADMIN_TARGETS: StaticTarget[] = ADMIN_SECTIONS.map((section) => ({
  kind: "admin",
  id: `admin:${section.slug}`,
  title: `Administration · ${section.title}`,
  subtitle: section.description,
  href: adminSectionHref(section),
  topics: section.topics,
  appId: null,
  adminOnly: true,
}));

export const STATIC_SEARCH_TARGETS: StaticTarget[] = [
  ...ADMIN_TARGETS,
  ...PLATFORM_TARGETS,
  ...SETTINGS_TARGETS,
  ...APP_SECTION_TARGETS,
];
