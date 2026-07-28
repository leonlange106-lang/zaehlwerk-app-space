import type { NextRequest } from "next/server";
import {
  calculateConsumption,
  calculateTariffCost,
  convertGasToKwh,
  groupReadingsByRegister,
  NOT_DELETED,
  pickTariffForDate,
  prisma,
} from "@zaehlwerk/database";
import { authenticateApiRequest, unauthorizedResponse } from "../../lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(value: string, sep: string): string {
  if (value.includes(sep) || /["\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "export";
}

/** Parst yyyy-mm-dd als UTC-Mitternacht; ungültige/leere Werte → null. */
function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export async function GET(request: NextRequest) {
  if (!(await authenticateApiRequest(request))) return unauthorizedResponse();

  const params = request.nextUrl.searchParams;
  // Zähler-Auswahl: `ids` (kommagetrennt) oder das alte einzelne `zaehlerId`.
  const idsParam = params.get("ids") ?? params.get("zaehlerId");
  const ids = idsParam
    ? idsParam.split(",").map((id) => id.trim()).filter(Boolean)
    : null;
  const from = parseDate(params.get("from"));
  const to = parseDate(params.get("to"));
  // Ende inklusiv: bis zum Ende des gewählten Tages.
  const toInclusive = to ? new Date(to.getTime() + 86_400_000 - 1) : null;

  // Trennzeichen bestimmt auch die Zahlen-/Datumsformatierung: Semikolon paart
  // mit deutschem Format (Dezimalkomma, TT.MM.JJJJ) für Excel-DE; Komma paart
  // mit internationalem Format (Dezimalpunkt, ISO-Datum), um Mehrdeutigkeit zu
  // vermeiden.
  const sep = params.get("sep") === "comma" ? "," : ";";
  const german = sep === ";";

  const fmtNumber = (value: number): string => {
    const s = value.toString();
    return german ? s.replace(".", ",") : s;
  };
  const fmtDate = (date: Date): string => {
    const iso = date.toISOString().slice(0, 10);
    if (!german) return iso;
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
  };

  const zaehlerList = await prisma.zaehler.findMany({
    where: ids ? { id: { in: ids } } : undefined,
    orderBy: [{ kategorie: "asc" }, { sortIndex: "asc" }],
    include: {
      ablesungen: { where: NOT_DELETED, orderBy: { datum: "asc" } },
      tarife: { orderBy: { gueltigAb: "asc" } },
      register: { orderBy: { sortIndex: "asc" } },
      umrechnungsfaktoren: { orderBy: { gueltigAb: "asc" } },
    },
  });

  const header = [
    "Zaehler",
    "Kategorie",
    "Datum",
    "Register",
    "Zaehlerstand",
    "Einheit",
    "Verbrauch",
    "Kosten_EUR",
    "Quelle",
  ];

  const lines: string[] = [];
  for (const zaehler of zaehlerList) {
    const isGas = zaehler.kategorie === "GAS";

    // JE REGISTER rechnen. Ein Zweirichtungszaehler meldet Bezug und Einspeisung
    // abwechselnd in dieselbe Reihe; ueber die gemischte Liste gerechnet ergaebe
    // jedes zweite Intervall einen negativen Verbrauch und das darauffolgende
    // einen Sprung ueber den ganzen Zaehlerstand. In einer CSV faellt das
    // niemandem auf — sie wird weiterverarbeitet, nicht gelesen.
    const groups =
      zaehler.register.length === 0
        ? [{ register: null, readings: zaehler.ablesungen }]
        : groupReadingsByRegister(zaehler.register, zaehler.ablesungen);
    const intervalByReadingId = new Map(
      groups
        .flatMap((group) => calculateConsumption(group.readings, { stellen: zaehler.stellen }))
        .map((interval) => [interval.toReadingId, interval]),
    );
    const registerByReadingId = new Map(
      groups.flatMap((group) =>
        group.readings.map((reading) => [reading.id, group.register] as const),
      ),
    );

    for (const ablesung of zaehler.ablesungen) {
      // Datumsfilter erst bei der Ausgabe anwenden — der Verbrauch wird aus der
      // vollständigen Historie berechnet, damit das Intervall am Bereichsanfang
      // korrekt bleibt.
      if (from && ablesung.datum < from) continue;
      if (toInclusive && ablesung.datum > toInclusive) continue;

      const interval = intervalByReadingId.get(ablesung.id) ?? null;
      const register = registerByReadingId.get(ablesung.id) ?? null;
      const isFeedIn = register?.richtung === "EINSPEISUNG";
      const verbrauch =
        !interval ? "" : interval.amount === null ? "unplausibel" : fmtNumber(interval.amount);

      // Kosten: erfasster Betrag hat Vorrang, sonst tarifbasiert berechnet.
      let kosten: string = ablesung.kosten != null ? fmtNumber(ablesung.kosten) : "";
      // Kein Bezugstarif auf eine Einspeisung. Der Arbeitspreis ist das, was
      // man fuers Beziehen zahlt; eingespeiste Kilowattstunden bringen eine
      // Verguetung ein, und das ist eine andere Rechnung.
      if (!kosten && !isFeedIn && interval && interval.amount !== null) {
        const tarif = pickTariffForDate(zaehler.tarife, interval.to);
        if (tarif) {
          // Gas faktorweise: Der Brennwert aendert sich monatlich, und ein
          // Intervall ueber einen Wechsel hinweg wird anteilig gerechnet.
          // Fehlt ein Faktor, bleibt die Kostenspalte LEER — eine geratene Zahl
          // in einer CSV faellt niemandem auf, weil sie weiterverarbeitet und
          // nicht gelesen wird.
          const verbrauchAbrechnung = isGas
            ? convertGasToKwh(
                interval.amount,
                interval.from,
                interval.to,
                zaehler.umrechnungsfaktoren,
              ).kwh
            : interval.amount;
          if (verbrauchAbrechnung !== null) {
            kosten = fmtNumber(
              Math.round(calculateTariffCost(tarif, verbrauchAbrechnung, interval.days) * 100) / 100,
            );
          }
        }
      }

      lines.push(
        [
          zaehler.name,
          zaehler.kategorie,
          fmtDate(ablesung.datum),
          register?.label ?? "Bezug",
          fmtNumber(ablesung.wert),
          zaehler.einheit,
          verbrauch,
          kosten,
          ablesung.quelle,
        ]
          .map((value) => csvEscape(value, sep))
          .join(sep),
      );
    }
  }

  const bom = "﻿";
  const csv = `${bom}${[header.join(sep), ...lines].join("\n")}\n`;

  const scope = ids
    ? zaehlerList.length === 1
      ? slugify(zaehlerList[0]?.name ?? "zaehler")
      : `${zaehlerList.length}-zaehler`
    : "alle-zaehler";
  const rangeSuffix = from || to ? `_${params.get("from") ?? "start"}_${params.get("to") ?? "ende"}` : "";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ablesungen-${scope}${rangeSuffix}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
