// Central registry of the apps hosted in the App Space. Shared by the launcher
// (landing tiles) and the header app-switcher so both stay in sync. Plain data
// only — safe to import from both Server and Client Components.

export interface AppDefinition {
  id: "zaehlwerk" | "log-analyzer";
  name: string;
  tagline: string;
  href: string;
  /** SVG in /public used as the brand tile icon. */
  icon: string;
  accent: string;
  available: boolean;
  /** Pathname (and prefix) that marks this app as the active context. */
  match: string;
}

export const APPS: AppDefinition[] = [
  {
    id: "zaehlwerk",
    name: "Zählwerk",
    tagline: "Zähler, Verbrauch, Tarife & Berichte",
    href: "/apps/zaehlwerk",
    icon: "/icon-zaehlwerk.svg",
    accent: "#20c997",
    available: true,
    match: "/apps/zaehlwerk",
  },
  {
    id: "log-analyzer",
    name: "MGflasher Log Analyzer",
    tagline: "Fahrzeug-Datenlogs auswerten & visualisieren",
    href: "/apps/log-analyzer",
    icon: "/icon-log-analyzer.svg",
    accent: "#fd7e14",
    available: false,
    match: "/apps/log-analyzer",
  },
];

/** The app whose context the given pathname belongs to, or null (hub/platform). */
export function activeAppFor(pathname: string): AppDefinition | null {
  return (
    APPS.find((app) => pathname === app.match || pathname.startsWith(`${app.match}/`)) ?? null
  );
}
