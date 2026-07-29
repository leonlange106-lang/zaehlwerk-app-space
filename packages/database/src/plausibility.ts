// Die eine Vorstellung davon, wann ein Zählerstand unplausibel ist.
//
// Vorher lag die Prüfung ausschliesslich in `POST /api/v1/readings` — als
// Ablauf im Route-Handler, nicht als Funktion. Das Formular (`createAblesung-
// Action`) schrieb ungeprüft, also bekam der Mensch weniger Schutz als das
// Skript, obwohl ein Vertipper beim Abtippen vom Zähler mindestens so
// wahrscheinlich ist wie eine fehlerhafte Automation.
//
// Deshalb steht sie hier und nicht dort: Sobald zwei Aufrufer dieselbe Frage
// stellen, muss die Antwort aus derselben Funktion kommen. Zwei Kopien
// driften — und eine Plausibilitätsregel, die je nach Eingabeweg anders
// urteilt, ist schlimmer als gar keine, weil niemand mehr sagen kann, was
// gespeichert werden durfte.

import { calculateConsumption, type ConsumptionInputReading, type ConsumptionInterval } from "./consumption";

/** Provisorische Id des zu prüfenden Standes — existiert nur im Speicher. */
export const PENDING_READING_ID = "__pending__";

export interface PlausibilityCandidate {
  datum: Date;
  wert: number;
  zaehlerGetauscht: boolean;
  startwertNeu: number | null;
}

export interface PlausibilityResult {
  /** `true`, wenn der Verbrauch bis zu diesem Stand negativ wäre. */
  implausible: boolean;
  /** Das Intervall, das der neue Stand abschliesst; `null`, wenn er der erste ist. */
  interval: ConsumptionInterval | null;
}

/**
 * Prüft einen neuen oder geänderten Zählerstand gegen die vorhandene Reihe.
 *
 * Das Verfahren ist bewusst kein eigener Vergleich, sondern ein Probelauf: Der
 * Kandidat wird provisorisch in die Historie eingefügt und durch dieselbe
 * `calculateConsumption` geschickt, die auch Detailseite und Bericht rechnen.
 * Damit kann die Prüfung nicht anders urteilen als die Anzeige — insbesondere
 * behandelt sie Zählertausch und Überlauf (`ZW-04`) automatisch richtig, statt
 * beides ein zweites Mal nachbilden zu müssen.
 *
 * `existing` muss **auf dieselbe Register-Reihe begrenzt** sein, in der der
 * Kandidat landet, und darf keine gelöschten Stände enthalten. Über den ganzen
 * Zähler gerechnet liefen Bezug und Einspeisung ineinander; da beide unabhängig
 * hochzählen, sähe fast jeder Stand nach negativem Verbrauch aus — die Prüfung
 * würde genau das ablehnen, was sie schützen soll.
 *
 * `excludeReadingId` ist der Fall „Bearbeiten": Der zu ändernde Stand muss aus
 * der Vergleichsreihe fallen, sonst prüft er gegen sich selbst.
 */
export function checkReadingPlausibility(
  existing: ConsumptionInputReading[],
  candidate: PlausibilityCandidate,
  options: { excludeReadingId?: string } = {},
): PlausibilityResult {
  const series = options.excludeReadingId
    ? existing.filter((reading) => reading.id !== options.excludeReadingId)
    : existing;

  const intervals = calculateConsumption([
    ...series,
    {
      id: PENDING_READING_ID,
      datum: candidate.datum,
      wert: candidate.wert,
      zaehlerGetauscht: candidate.zaehlerGetauscht,
      startwertNeu: candidate.startwertNeu,
    },
  ]);

  const interval = intervals.find((entry) => entry.toReadingId === PENDING_READING_ID) ?? null;

  // Ein erster Stand hat kein Intervall und kann nicht unplausibel sein — es
  // gibt nichts, wogegen er fallen könnte.
  return { implausible: interval !== null && interval.amount === null, interval };
}

/**
 * Der Satz, den der Nutzer zu sehen bekommt — mit der konkreten Zahl.
 *
 * „Ungültig" allein erklärt nichts und lässt nur die Wahl zwischen Aufgeben und
 * Raten. Die Differenz zu nennen macht den Tippfehler in aller Regel sofort
 * sichtbar (eine Stelle zu wenig, Ziffern vertauscht).
 */
export function describeImplausibleReading(
  previousValue: number,
  candidateValue: number,
  unit: string,
): string {
  const delta = candidateValue - previousValue;
  const formatted = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(delta);
  return `Der Verbrauch seit der vorherigen Ablesung wäre ${formatted} ${unit} — der neue Stand liegt unter dem letzten.`;
}
