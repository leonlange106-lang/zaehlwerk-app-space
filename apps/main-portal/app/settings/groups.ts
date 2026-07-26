// The five groups the platform settings are split into.
//
// Plain data, no imports from React or Prisma, so the three places that need it
// can all read the SAME list: the settings index and its sub-pages, the
// navigation menu's settings level, and the search index. That shared list is
// the point — a group added here appears in navigation and becomes findable
// without touching either of them, and none of the three can drift.
//
// Why sub-pages at all: the single stacked page measured **13 629 px** tall on a
// 390 px phone. That is not a screen, it is a scroll, and everything below the
// first two cards was effectively unreachable.

export type SettingsGroupId =
  | "sicherheit"
  | "benutzer"
  | "integrationen"
  | "daten"
  | "system";

export interface SettingsGroup {
  id: SettingsGroupId;
  /** Route segment — German, because it is a user-visible URL in a German UI. */
  slug: SettingsGroupId;
  title: string;
  /** One line, shown on the index tile and as the search result's context. */
  description: string;
  /** Tabler icon name, resolved by the consumer (this file stays React-free). */
  icon: "shield-lock" | "users" | "plug" | "database" | "refresh";
  /** Hidden entirely from non-admins — both the tile and the search hit. */
  adminOnly: boolean;
  /**
   * What a person might type when looking for something on this page.
   *
   * These are the labels of the CARDS the page holds, not a keyword-stuffing
   * exercise: someone hunting for "Backup" should not have to know it lives
   * under "Daten". Kept next to the group so adding a card and making it
   * findable are one edit.
   */
  topics: string[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: "sicherheit",
    slug: "sicherheit",
    title: "Sicherheit & Zugriff",
    description: "Zwei-Faktor-Authentifizierung, instanzweite Pflicht und das Audit-Log.",
    icon: "shield-lock",
    // Not admin-only: every account manages its OWN second factor here. The
    // instance-wide switch inside the card is what checks for admin.
    adminOnly: false,
    topics: [
      "Zwei-Faktor-Authentifizierung",
      "2FA",
      "TOTP",
      "Authenticator",
      "Passwort",
      "Audit-Log",
      "Protokoll",
      "Anmeldungen",
    ],
  },
  {
    id: "benutzer",
    slug: "benutzer",
    title: "Benutzer & Rechte",
    description: "Konten anlegen, Rollen vergeben und App-Freigaben verwalten.",
    icon: "users",
    adminOnly: true,
    topics: ["Benutzer", "Konten", "Rollen", "Administrator", "App-Freigaben", "Einladung"],
  },
  {
    id: "integrationen",
    slug: "integrationen",
    title: "Integrationen",
    description: "Personal Access Tokens und API-Schlüssel für den automatischen Log-Import.",
    icon: "plug",
    // The PAT card is per-account, like the second factor — the ingestion keys
    // inside are admin-gated by their own card.
    adminOnly: false,
    topics: [
      "API",
      "Token",
      "Personal Access Token",
      "PAT",
      "API-Schlüssel",
      "Ingestion",
      "Home Assistant",
      "Smart Home",
      "Watch-Folder",
    ],
  },
  {
    id: "daten",
    slug: "daten",
    title: "Daten & Backup",
    description: "Sicherungen, Aufbewahrung, Import/Export und Datenbank-Wartung.",
    icon: "database",
    adminOnly: true,
    topics: [
      "Backup",
      "Sicherung",
      "Snapshot",
      "Wiederherstellen",
      "Export",
      "Import",
      "Aufbewahrung",
      "Retention",
      "Datenbank",
      "Wartung",
      "VACUUM",
      "Speicherplatz",
    ],
  },
  {
    id: "system",
    slug: "system",
    title: "System & Update",
    description: "Version, Release-Channel, Self-Update und Rückkehr zu einer früheren Version.",
    icon: "refresh",
    // Not admin-only: the version and channel are worth seeing. Triggering an
    // update is admin-gated inside the card, as it always was.
    adminOnly: false,
    topics: [
      "Update",
      "Aktualisierung",
      "Version",
      "Release",
      "Channel",
      "Beta",
      "Stable",
      "Rollback",
      "Zurückrollen",
      "Changelog",
    ],
  },
];

export function settingsGroupBySlug(slug: string): SettingsGroup | null {
  return SETTINGS_GROUPS.find((group) => group.slug === slug) ?? null;
}

/** The groups a given role may see. */
export function visibleSettingsGroups(isAdmin: boolean): SettingsGroup[] {
  return SETTINGS_GROUPS.filter((group) => isAdmin || !group.adminOnly);
}

export function settingsGroupHref(group: Pick<SettingsGroup, "slug">): string {
  return `/settings/${group.slug}`;
}
