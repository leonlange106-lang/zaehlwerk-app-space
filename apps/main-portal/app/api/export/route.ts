import type { NextRequest } from "next/server";
import {
  calculateConsumption,
  calculateTariffCost,
  gasM3ToKwh,
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
      ablesungen: { orderBy: { datum: "asc" } },
      tarife: { orderBy: { gueltigAb: "asc" } },
    },
  });

  const header = [
    "Zaehler",
    "Kategorie",
    "Datum",
    "Zaehlerstand",
    "Einheit",
    "Verbrauch",
    "Kosten_EUR",
    "Quelle",
  ];

  const lines: string[] = [];
  for (const zaehler of zaehlerList) {
    const isGas = zaehler.kategorie === "GAS";
    const intervals = calculateConsumption(zaehler.ablesungen, { stellen: zaehler.stellen });
    const intervalByReadingId = new Map(intervals.map((interval) => [interval.toReadingId, interval]));

    for (const ablesung of zaehler.ablesungen) {
      // Datumsfilter erst bei der Ausgabe anwenden — der Verbrauch wird aus der
      // vollständigen Historie berechnet, damit das Intervall am Bereichsanfang
      // korrekt bleibt.
      if (from && ablesung.datum < from) continue;
      if (toInclusive && ablesung.datum > toInclusive) continue;

      const interval = intervalByReadingId.get(ablesung.id) ?? null;
      const verbrauch =
        !interval ? "" : interval.amount === null ? "unplausibel" : fmtNumber(interval.amount);

      // Kosten: erfasster Betrag hat Vorrang, sonst tarifbasiert berechnet.
      let kosten: string = ablesung.kosten != null ? fmtNumber(ablesung.kosten) : "";
      if (!kosten && interval && interval.amount !== null) {
        const tarif = pickTariffForDate(zaehler.tarife, interval.to);
        if (tarif) {
          const verbrauchAbrechnung = isGas ? gasM3ToKwh(interval.amount) : interval.amount;
          kosten = fmtNumber(
            Math.round(calculateTariffCost(tarif, verbrauchAbrechnung, interval.days) * 100) / 100,
          );
        }
      }

      lines.push(
        [
          zaehler.name,
          zaehler.kategorie,
          fmtDate(ablesung.datum),
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
