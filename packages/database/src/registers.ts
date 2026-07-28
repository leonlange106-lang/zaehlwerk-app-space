/**
 * Ablesungen nach Registern trennen.
 *
 * Warum das eine eigene Datei ist: Ein Zweirichtungszähler führt zwei Zählwerke,
 * die beide für sich hochzählen — 1.8.0 den Bezug, 2.8.0 die Einspeisung. Beide
 * Reihen laufen in derselben Tabelle, chronologisch verschränkt. Rechnet man
 * Verbrauch über die gemischte Liste, entsteht Unsinn: Auf einen Bezugsstand von
 * 45 000 folgt ein Einspeisestand von 1 200, das Delta ist negativ, und die
 * nächste Zeile springt wieder um 43 800 nach oben. Kein einziges Intervall wäre
 * richtig, und ausgerechnet die Zahlen sähen plausibel aus, die es nicht sind.
 *
 * Die Trennung ist reine Logik und gehört deshalb hierhin, nicht in eine
 * Komponente: Die Detailseite, die Berichte und die API brauchen alle dieselbe
 * Aufteilung, und drei Fassungen davon driften auseinander.
 */

import { DEFAULT_OBIS_CODE, obisSortIndex, type RegisterRichtungValue } from "./obis";
import type { ConsumptionStats } from "./consumption";

/** Was diese Datei von einem Register braucht — bewusst weniger als das Modell hat. */
export interface RegisterLike {
  id: string;
  obisCode: string;
  richtung: RegisterRichtungValue;
  label: string;
  sortIndex: number;
}

/** Was sie von einer Ablesung braucht: die Zugehörigkeit, sonst nichts. */
export interface RegisterScopedReading {
  registerId: string | null;
}

export interface RegisterGroup<TReading> {
  register: RegisterLike;
  /** Die Ablesungen dieses Registers, in der Reihenfolge der Eingabe. */
  readings: TReading[];
}

/**
 * Das Register, dem ein Stand ohne Registerbezug gehört.
 *
 * `registerId === null` ist kein Datenfehler, sondern der Normalfall für alles,
 * was vor der Einführung der Register erfasst wurde — und für alles, was eine
 * zurückgerollte Anwendung danach noch schreibt. Diese Stände sind Bezug, denn
 * genau das war die einzige Bedeutung, die ein Zählerstand damals haben konnte.
 */
function defaultRegisterOf(registers: RegisterLike[]): RegisterLike | null {
  return registers.find((register) => register.obisCode === DEFAULT_OBIS_CODE) ?? null;
}

/**
 * Ablesungen den Registern zuordnen.
 *
 * Register ohne Ablesungen bleiben in der Liste — ein frisch angelegtes
 * Einspeiseregister soll in der Oberfläche auftauchen, bevor der erste Stand
 * eingeht, sonst sieht es aus, als wäre das Anlegen fehlgeschlagen.
 *
 * Ablesungen, deren Register nicht in `registers` steht, landen beim
 * Standardregister statt im Nichts: Sie zu verschlucken hiesse, Verbrauch
 * verschwinden zu lassen, und das fällt niemandem auf.
 */
export function groupReadingsByRegister<TReading extends RegisterScopedReading>(
  registers: RegisterLike[],
  readings: TReading[],
): RegisterGroup<TReading>[] {
  const ordered = [...registers].sort(
    (a, b) => a.sortIndex - b.sortIndex || obisSortIndex(a.obisCode) - obisSortIndex(b.obisCode),
  );
  const byId = new Map(ordered.map((register) => [register.id, register]));
  const fallback = defaultRegisterOf(ordered) ?? ordered[0] ?? null;

  const groups = new Map<string, TReading[]>(ordered.map((register) => [register.id, []]));

  for (const reading of readings) {
    const target =
      (reading.registerId !== null ? byId.get(reading.registerId) : undefined) ?? fallback;
    // Kein einziges Register vorhanden: Dann gibt es nichts zuzuordnen, und der
    // Aufrufer arbeitet ohnehin auf der flachen Liste weiter.
    if (!target) continue;
    groups.get(target.id)!.push(reading);
  }

  return ordered.map((register) => ({ register, readings: groups.get(register.id)! }));
}

/**
 * Führt dieser Zähler mehr als eine Reihe?
 *
 * Die Frage entscheidet in der Oberfläche darüber, ob überhaupt etwas anders
 * aussieht als bisher. Ein gewöhnlicher Zähler hat genau ein Register, und für
 * ihn soll sich durch die Zweirichtungsfähigkeit nichts ändern — keine
 * zusätzliche Spalte, keine Umschaltung, kein erklärungsbedürftiger Hinweis.
 */
export function hasMultipleRegisters(registers: RegisterLike[]): boolean {
  return registers.length > 1;
}

/**
 * Kennzahlen mehrerer Registerreihen zu einer zusammenfassen.
 *
 * Nicht einfach die Intervalle aneinanderhängen und `computeConsumptionStats`
 * darüber laufen lassen: Dessen Tagessumme setzt voraus, dass die Intervalle
 * lückenlos aufeinander folgen — innerhalb EINER Reihe stimmt das, über zwei
 * hinweg nicht. Bei einem Doppeltarifzähler (1.8.1 und 1.8.2) zählte derselbe
 * Kalendertag dann zweimal, und der Tagesschnitt käme halb so hoch heraus, wie
 * er ist. Falsch, aber unauffällig falsch — die Zahl sieht plausibel aus.
 *
 * Richtig ist: Verbrauch addieren, Zeitraum NICHT. Die Reihen laufen parallel
 * durch denselben Zeitraum, also zählt die längste von ihnen.
 */
export function combineRegisterStats(stats: ConsumptionStats[]): ConsumptionStats | null {
  const present = stats.filter((entry) => entry.intervalCount > 0 || entry.totalDays > 0);
  if (present.length === 0) return null;

  const total = present.reduce((sum, entry) => sum + entry.total, 0);
  const totalDays = Math.max(...present.map((entry) => entry.totalDays));
  const perDay = present
    .flatMap((entry) => [entry.maxPerDay, entry.minPerDay])
    .filter((value): value is number => value !== null);

  return {
    total,
    totalDays,
    avgPerDay: totalDays > 0 ? total / totalDays : null,
    maxPerDay: perDay.length > 0 ? Math.max(...perDay) : null,
    minPerDay: perDay.length > 0 ? Math.min(...perDay) : null,
    intervalCount: present.reduce((sum, entry) => sum + entry.intervalCount, 0),
    hasImplausibleIntervals: present.some((entry) => entry.hasImplausibleIntervals),
  };
}

/** Die Register einer Richtung — Bezug für den Verbrauch, Einspeisung für den Ertrag. */
export function registersByDirection(
  registers: RegisterLike[],
  richtung: RegisterRichtungValue,
): RegisterLike[] {
  return registers.filter((register) => register.richtung === richtung);
}

/**
 * Die Ablesungen, die in eine Verbrauchsrechnung gehören.
 *
 * Ohne Register (Altbestand, gewöhnlicher Zähler) ist das die ganze Liste.
 * Sonst nur der Bezug: Eingespeiste Kilowattstunden sind kein Verbrauch, und sie
 * in eine Jahreshochrechnung oder eine Kostenschätzung einzurechnen kehrte deren
 * Vorzeichen um — aus 4 000 kWh Bezug und 3 000 kWh Einspeisung würde nicht
 * "1 000 netto", sondern eine wilde Folge aus Sprüngen in beide Richtungen.
 */
export function consumptionReadings<TReading extends RegisterScopedReading>(
  registers: RegisterLike[],
  readings: TReading[],
): TReading[] {
  if (registers.length === 0) return readings;

  // Über ALLE Register gruppieren und erst danach aussieben — nicht umgekehrt.
  //
  // Gruppierte man gleich nur über die Bezugsregister, wäre die Kennung eines
  // Einspeisestandes dort unbekannt, und der Rückfall aufs Standardregister
  // zöge genau die Werte in die Verbrauchsreihe, die hier heraus sollen. Der
  // Rückfall ist für Stände OHNE Zuordnung gedacht, nicht für solche mit einer
  // bewusst anderen.
  return groupReadingsByRegister(registers, readings)
    .filter((group) => group.register.richtung === "BEZUG")
    .flatMap((group) => group.readings);
  // Ein Zähler ganz ohne Bezugsregister — eine reine Erzeugungsanlage — liefert
  // hier eine leere Liste. Das ist die richtige Antwort, nicht "alles".
}
