// Die Bereiche der Admin-App.
//
// Dieselbe Bauform wie `settings/groups.ts`, und aus demselben Grund: eine
// Liste, aus der Route, Navigationsebene und Übersicht leben. Ein Bereich, der
// hier steht, taucht überall auf, ohne dass drei Dateien angefasst werden.
//
// **Warum eine eigene App und kein Abschnitt der Einstellungen.** Die
// Plattform-Einstellungen beantworten „wie soll es sich verhalten" — sie werden
// gelesen, geändert, verlassen. Der Admin-Bereich beantwortet „was tut es
// gerade": Zahlen, die sich fortlaufend ändern und die man beobachtet. Beides
// in eine Seite zu legen hieße, eine Konfigurationsseite ständig neu zu laden.
//
// Und es ist datenreich. Ein einzelnes Dashboard mit Speicher, Prozess,
// Datenbank, Zugriffen und Verkehr nebeneinander wird eine Wand aus Zahlen —
// getrennt nach Frage bleibt es lesbar.

export type AdminSectionId = "system" | "traffic" | "database" | "activity";

export interface AdminSection {
  id: AdminSectionId;
  slug: AdminSectionId;
  title: string;
  /** Die Frage, die dieser Bereich beantwortet — nicht seine Bestandteile. */
  description: string;
  /** Tabler-Icon-Name; aufgelöst beim Verbraucher, damit diese Datei React-frei bleibt. */
  icon: "server-bolt" | "world" | "database" | "activity";
  /** Wörter, unter denen jemand diesen Bereich sucht. Speist den Suchindex. */
  topics: string[];
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: "system",
    slug: "system",
    title: "System & Prozess",
    description: "Speicher, Laufzeit, Node-Prozess und Host — was die Instanz gerade verbraucht.",
    icon: "server-bolt",
    topics: ["Speicher", "RAM", "Heap", "Uptime", "Prozess", "Host", "Cache", "Node"],
  },
  {
    id: "traffic",
    slug: "traffic",
    title: "Zugriffe & Verkehr",
    description: "Aufrufe, Herkunft und Datenmenge — gemessen an der Kante, vor der Anwendung.",
    icon: "world",
    topics: ["Zugriffe", "Traffic", "Cloudflare", "Requests", "Bandbreite", "Länder", "IP", "Bots"],
  },
  {
    id: "database",
    slug: "database",
    title: "Datenbank",
    description: "Größe, Tabellen und Wartungsstand der SQLite-Datei.",
    icon: "database",
    topics: ["Datenbank", "SQLite", "Größe", "Tabellen", "VACUUM", "Wartung", "Speicherplatz"],
  },
  {
    id: "activity",
    slug: "activity",
    title: "Aktivität",
    description: "Wer was wann getan hat — Audit-Log und angemeldete Konten.",
    icon: "activity",
    topics: ["Audit", "Protokoll", "Anmeldungen", "Benutzer", "Sitzungen", "Verlauf"],
  },
];

export function adminSectionBySlug(slug: string): AdminSection | null {
  return ADMIN_SECTIONS.find((section) => section.slug === slug) ?? null;
}

export function adminSectionHref(section: Pick<AdminSection, "slug">): string {
  return `/apps/admin/${section.slug}`;
}
