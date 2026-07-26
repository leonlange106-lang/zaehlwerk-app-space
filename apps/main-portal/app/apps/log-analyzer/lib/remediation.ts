// What to look at when the evaluation flags something. Pure data + one lookup —
// no Prisma, no React.
//
// **These explain a verdict; they never change one.** That is why there is no
// `EVALUATION_RULES_VERSION` bump here, and why nothing in this file is imported
// by `evaluate-log-pull.ts`. Bumping it reflexively for any change under
// `lib/` is the easy mistake: it belongs to changes in how a log is *judged*,
// and a suggestion is not a judgement.
//
// Anchored on `SafetyAlert.id`, which is already stable (`knock`, `egt-limit`, …)
// — the alert ids are what the charts and the report key off, so reusing them
// keeps one vocabulary instead of inventing a parallel one.
//
// **Tone.** These are interventions on someone's car, and a datalog is not a
// diagnosis. Everything is phrased as "prüfen" or "erwägen", never as an
// instruction, and every list is ordered cheap-and-likely first so nobody is
// sent to buy turbos over what a tank of better fuel would settle.

export interface Remediation {
  /** Ordered: the first entry is the cheapest thing that plausibly explains it. */
  steps: string[];
  /** Why these, in one sentence — the mechanism, so the list is not a ritual. */
  rationale: string;
}

const REMEDIATIONS: Record<string, Remediation> = {
  knock: {
    rationale:
      "Zündwinkelrücknahme ist die Schutzreaktion der Motorsteuerung auf klopfende Verbrennung. Die häufigsten Ursachen sind Kraftstoffqualität und Zündanlage — beides deutlich billiger als das, was danach kommt.",
    steps: [
      "Höhere Oktanzahl tanken und einen Vergleichslog fahren — der schnellste Test, ob es am Kraftstoff liegt.",
      "Zündkerzen prüfen: Elektrodenabstand, Alter, korrekter Wärmewert für die gefahrene Leistung.",
      "Zündspulen prüfen — einzelne schwache Spulen zeigen sich oft nur unter Last.",
      "Ansaug- und Ladeluftstrecke auf Undichtigkeiten prüfen (Chargepipe, Schellen, Ladeluftkühler).",
      "Bleibt es dabei: Map/Tuning überprüfen lassen, bevor mechanisch weitergesucht wird.",
    ],
  },
  "knock-total": {
    rationale:
      "Die Rücknahme verteilt sich über mehrere Zylinder gleichzeitig. Das spricht eher für eine gemeinsame Ursache — Kraftstoff, Ladeluft, Map — als für ein Bauteil an einem Zylinder.",
    steps: [
      "Kraftstoff prüfen: Oktanzahl, Alter der Tankfüllung, Ethanolgehalt bei E-Kraftstoffen.",
      "Ansauglufttemperatur im selben Log ansehen — heiße Ladeluft erzwingt Rücknahme ganz ohne Defekt.",
      "Ladeluftkühlung prüfen (Verschmutzung, Luftführung, bei Wassersystemen Pumpe und Füllstand).",
      "Map/Tuning überprüfen lassen, wenn die Rücknahme über alle Zylinder gleichmäßig auftritt.",
    ],
  },
  "egt-limit": {
    rationale:
      "Abgastemperatur ist die Größe, die Katalysator und Turbine zuerst kostet. Sie steigt durch magere Gemische, späte Zündung und hohe Last bei schlechter Kühlung.",
    steps: [
      "Gemisch im selben Log prüfen: Lambda unter Volllast, Kraftstofftrims, HPFP-Druck.",
      "Kraftstoffversorgung prüfen — ein einbrechender Raildruck magert unter Last ab und heizt.",
      "Ansauglufttemperatur und Ladeluftkühlung prüfen.",
      "Abgasseitige Restriktion erwägen (zugesetzter Katalysator), wenn Gemisch und Ladeluft unauffällig sind.",
    ],
  },
  "lambda-lean": {
    rationale:
      "Ein mageres Gemisch unter Volllast ist die direkte Vorstufe zu Klopfen und hoher Abgastemperatur. Fast immer steht die Kraftstoffversorgung dahinter, nicht die Luftseite.",
    steps: [
      "HPFP-Druck im selben Log prüfen — bricht er unter Last ein, ist die Ursache dort.",
      "Kraftstofffilter und Niederdruckpumpe prüfen.",
      "Injektoren prüfen lassen (Verteilung, Dichtheit).",
      "Bei E-Kraftstoffen: tatsächlichen Ethanolgehalt gegen die im Profil hinterlegte Annahme prüfen.",
    ],
  },
  "hpfp-drop": {
    rationale:
      "Der Raildruck folgt der Anforderung nicht mehr. Das ist eine Versorgungsfrage — die Pumpe ist dabei die teuerste und deshalb letzte Vermutung.",
    steps: [
      "Kraftstofffilter prüfen bzw. wechseln.",
      "Niederdruckpumpe und Vorförderdruck prüfen.",
      "Hochdruckpumpe prüfen lassen (bei hohen Laufleistungen ein bekannter Verschleißpunkt).",
      "Bei aufgerüsteter Hardware: passt die Pumpe zur angeforderten Leistung des Maps?",
    ],
  },
  "hpfp-low": {
    rationale:
      "Der Raildruck liegt dauerhaft unter dem, was die Einspritzung bei dieser Last braucht.",
    steps: [
      "Kraftstofffilter und Vorförderdruck prüfen.",
      "Hochdruckpumpe prüfen lassen.",
      "Prüfen, ob das Fahrzeugprofil die tatsächlich verbaute Pumpe abbildet — ein OEM-Limit auf einer aufgerüsteten Pumpe warnt zu früh.",
    ],
  },
  "boost-deviation": {
    rationale:
      "Ist-Ladedruck folgt dem Sollwert nicht. Vor der Turbine stehen deutlich billigere Ursachen: Undichtigkeiten und Steller.",
    steps: [
      "Ladeluftstrecke auf Undichtigkeiten prüfen — Chargepipe, Schellen, Schläuche, Ladeluftkühler.",
      "Wastegate/Ladedrucksteller auf Leichtgängigkeit und korrekte Ansteuerung prüfen.",
      "Bypass-/Schubumluftventil auf Dichtheit prüfen.",
      "Turbolader erst danach in Betracht ziehen.",
    ],
  },
  "boost-limit": {
    rationale:
      "Der Ladedruck liegt über dem, was für diese Hardware plausibel ist. Das ist so oft ein falsch hinterlegtes Profil wie ein reales Überschwingen.",
    steps: [
      "Fahrzeugprofil prüfen: Turbo, Tuning-Stufe und Motor müssen dem entsprechen, was verbaut ist.",
      "Ladedruckregelung auf Überschwingen prüfen (Spike beim Anstieg statt dauerhaft zu hoch).",
      "Bei anhaltend zu hohem Druck: Map überprüfen lassen.",
    ],
  },
  "iat-limit": {
    rationale:
      "Heiße Ansaugluft erzwingt Zündwinkelrücknahme, ganz ohne Defekt. Ein Log aus dem Stand nach mehreren Läufen sieht deshalb schlechter aus, als das Auto ist.",
    steps: [
      "Zwischen den Läufen abkühlen lassen und einen Vergleichslog bei kühlerer Ladeluft fahren.",
      "Ladeluftkühler auf Verschmutzung und die Luftführung dahin prüfen.",
      "Bei Wasser-Ladeluftkühlung Pumpe, Füllstand und Kreislauf prüfen.",
    ],
  },
  stft: {
    rationale:
      "Kurzzeit-Trims zeigen, wie stark die Steuerung gerade gegensteuern muss. Große Werte deuten auf Falschluft oder auf Messfehler in der Luftmasse.",
    steps: [
      "Ansaugstrecke auf Falschluft prüfen (Schläuche, Dichtungen, Kurbelgehäuseentlüftung).",
      "Luftmassen-/Ladedrucksensor auf Verschmutzung prüfen.",
      "Kraftstoffversorgung prüfen, wenn die Abweichung nur unter Last auftritt.",
    ],
  },
  ltft: {
    rationale:
      "Langzeit-Trims sind das gelernte Mittel: sie beschreiben einen Dauerzustand, keinen Ausreißer.",
    steps: [
      "Ansaugstrecke auf Falschluft prüfen, inklusive Kurbelgehäuseentlüftung.",
      "Luftmassen-/Ladedrucksensor prüfen.",
      "Nach einer Reparatur die Adaptionen zurücksetzen lassen und neu loggen.",
    ],
  },
};

/**
 * Suggestions for an alert id, or null when we have nothing useful to add.
 *
 * Per-cylinder ids arrive as `knock-1`, `trim-stft` and so on — the prefix is
 * the mechanism and the suffix is only where it was seen, so the lookup falls
 * back to the prefix rather than silently offering nothing for the alerts that
 * matter most.
 */
export function remediationFor(alertId: string): Remediation | null {
  if (REMEDIATIONS[alertId]) return REMEDIATIONS[alertId];
  if (alertId.startsWith("knock-")) return REMEDIATIONS.knock;
  if (alertId.startsWith("trim-")) {
    return alertId.endsWith("ltft") ? REMEDIATIONS.ltft : REMEDIATIONS.stft;
  }
  return null;
}

/** The sentence that has to accompany every list of suggestions. */
export const REMEDIATION_DISCLAIMER =
  "Diese Auswertung interpretiert ein Datenlog und ersetzt keine Diagnose. Die Punkte sind Ansatzpunkte zum Prüfen — von naheliegend und günstig nach aufwendig sortiert.";
