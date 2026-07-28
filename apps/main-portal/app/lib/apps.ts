// Central registry of the apps hosted in the App Space. Shared by the launcher
// (landing tiles) and the header app-switcher so both stay in sync. Plain data
// only — safe to import from both Server and Client Components.

export interface AppDefinition {
  id: "zaehlwerk" | "log-analyzer" | "admin";
  name: string;
  tagline: string;
  href: string;
  /** SVG in /public used as the brand tile icon. */
  icon: string;
  accent: string;
  available: boolean;
  /** Pathname (and prefix) that marks this app as the active context. */
  match: string;
  /**
   * Nur fuer Administratoren, unabhaengig von den App-Freigaben.
   *
   * Die Freigaben in `allowedApps` regeln, wer eine FACH-App sehen darf. Der
   * Admin-Bereich ist keine Fach-App: er zeigt den Zustand der Plattform, und
   * das haengt an der Rolle, nicht an einer Zuweisung. Ohne dieses Flag muesste
   * man ihn jedem Admin einzeln freischalten — und koennte ihn versehentlich
   * einem Nicht-Admin geben.
   */
  adminOnly?: boolean;
}

export const APPS: AppDefinition[] = [
  {
    id: "zaehlwerk",
    name: "Zählwerk",
    tagline: "Zähler, Verbrauch, Tarife & Berichte",
    href: "/apps/zaehlwerk",
    icon: "/icon-zaehlwerk.svg",
    // Energy accent — vivid electric cyan.
    accent: "#06b6d4",
    available: true,
    match: "/apps/zaehlwerk",
  },
  {
    id: "log-analyzer",
    // Named for what it does, not for one tool that produces its input: MGflasher
    // CSVs are the best-supported format, but any datalog CSV with recognisable
    // channels is parsed. The id stays "log-analyzer" — it is in URLs and in the
    // allowedApps JSON on every user row.
    name: "Log Analyzer",
    tagline: "Datenlogs auswerten, vergleichen & Leistung schätzen",
    href: "/apps/log-analyzer",
    icon: "/icon-log-analyzer.svg",
    // Automotive accent — high-octane orange.
    accent: "#f97316",
    available: true,
    match: "/apps/log-analyzer",
  },
  {
    id: "admin",
    name: "Administration",
    tagline: "Zustand der Plattform: System, Zugriffe, Datenbank, Aktivitaet",
    href: "/apps/admin",
    icon: "/icon-admin.svg",
    // Neutrales Schiefer statt eines Produktakzents: dieser Bereich gehoert
    // keiner Fach-App, und ein eigener bunter Akzent wuerde ihn wie eine
    // dritte gleichrangige App aussehen lassen.
    accent: "#64748b",
    available: true,
    adminOnly: true,
    match: "/apps/admin",
  },
];

/** The app whose context the given pathname belongs to, or null (hub/platform). */
export function activeAppFor(pathname: string): AppDefinition | null {
  return (
    APPS.find((app) => pathname === app.match || pathname.startsWith(`${app.match}/`)) ?? null
  );
}
