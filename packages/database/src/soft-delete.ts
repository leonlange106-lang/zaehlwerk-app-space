/**
 * Der Filter für „nicht gelöschte" Ablesungen.
 *
 * Als EINE Konstante, nicht als `{ geloeschtAm: null }` an fünfzehn Stellen.
 * Der klassische Fehler eines Soft-Delete ist die vergessene Abfrage: Eine
 * gelöschte Zeile taucht dann irgendwo wieder auf — in einem Export, einer
 * Summe, einer Erinnerung — und ausgerechnet dort, wo niemand hinsieht.
 *
 * Wer diesen Filter NICHT setzt, tut das hoffentlich absichtlich. Die drei
 * Stellen, an denen das richtig ist:
 *
 *   * Backup und Zähler-Export — sie sollen den Bestand abbilden, nicht die
 *     Ansicht. Eine Sicherung, die stillschweigend Zeilen weglässt, ist keine.
 *   * Der Papierkorb selbst.
 *   * Wartungszahlen (`db-maintenance`), die die Tabellengröße messen.
 */
export const NOT_DELETED = { geloeschtAm: null } as const;

/** Nur die gelöschten — für den Papierkorb. */
export const ONLY_DELETED = { geloeschtAm: { not: null } } as const;
