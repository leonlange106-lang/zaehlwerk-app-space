import { IconArrowDownRight, IconArrowUpRight, IconMinus } from "@tabler/icons-react";
import { Badge } from "@/app/components/ui/Badge";
import { Table, TableScroll, Td, Th } from "@/app/components/ui/primitives";
import {
  ENERGY_CATEGORY_LABELS,
  type ConsumptionProjection,
  type EnergyCategoryValue,
} from "@zaehlwerk/database/client";

const num0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const pct = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
const dateFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const CONFIDENCE: Record<ConsumptionProjection["confidence"], { label: string; token: string }> = {
  low: { label: "wenig Daten", token: "var(--zw-neutral)" },
  medium: { label: "mittel", token: "var(--zw-watch)" },
  high: { label: "hoch", token: "var(--zw-ok)" },
};

const METHOD_LABEL: Record<ConsumptionProjection["method"], string> = {
  linear: "Linear",
  seasonal: "Saisonal",
};

/**
 * Delta-Chip. Ein Anstieg ist hier das Schlechte (mehr Verbrauch, mehr Kosten),
 * ein Rückgang das Gute. Die Richtung trägt der Pfeil, nicht die Farbe — sowohl
 * ein Graustufendruck des Berichts als auch eine Rot-Grün-Schwäche brauchen ihn.
 */
export function DeltaBadge({ pct: value }: { pct: number | null }) {
  if (value === null) {
    return (
      <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-line px-2.5 text-[11px] font-semibold text-dim">
        <IconMinus size={12} stroke={2.2} />
        n/a
      </span>
    );
  }
  const up = value > 0.05;
  const down = value < -0.05;
  const token = up ? "var(--zw-risk)" : down ? "var(--zw-ok)" : "var(--zw-neutral)";
  const Icon = up ? IconArrowUpRight : down ? IconArrowDownRight : IconMinus;
  return (
    <span
      className="inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-semibold"
      style={{
        color: token,
        borderColor: `color-mix(in srgb, ${token} 38%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${token} 12%, transparent)`,
      }}
    >
      <Icon size={12} stroke={2.2} />
      {pct.format(value)} %
    </span>
  );
}

/** Kompakte Kennzahlen einer einzelnen Jahres-Hochrechnung (für die Detailseite). */
export function ProjectionStats({ projection }: { projection: ConsumptionProjection }) {
  const p = projection;

  if (p.projectedAnnual === null) {
    return (
      <p className="text-sm text-dim">
        Noch zu wenige Ablesungen für eine belastbare Hochrechnung – es werden mindestens zwei
        Ablesungen im Abstand von einigen Wochen benötigt.
      </p>
    );
  }

  // Die Hochrechnung bezieht sich auf das gleitende Jahr bis zur jüngsten
  // Ablesung, nicht auf das Kalenderjahr — bei einer reinen Jahresablesung ist
  // das exakt der zuletzt gemessene Jahresverbrauch.
  const anchor = new Date(p.anchorDate);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{METHOD_LABEL[p.method]}</Badge>
        <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-line px-2.5 text-[11px] font-semibold text-dim">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: CONFIDENCE[p.confidence].token }}
          />
          Konfidenz: {CONFIDENCE[p.confidence].label}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <p className="legend-label">Hochrechnung / Jahr</p>
          <p className="readout mt-1 text-readout">
            {num1.format(p.projectedAnnual)} <span className="text-dim">{p.unit}</span>
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-dim">
            vs. Vorjahr <DeltaBadge pct={p.deltaConsumptionPct} />
          </p>
        </div>

        {p.projectedAnnualCost !== null && (
          <div>
            <p className="legend-label">Geschätzte Jahreskosten</p>
            <p className="readout mt-1 text-readout">{eur.format(p.projectedAnnualCost)}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-dim">
              vs. Vorjahr <DeltaBadge pct={p.deltaCostPct} />
            </p>
          </div>
        )}

        <div>
          <p className="legend-label">Letzte 12 Monate</p>
          <p className="readout mt-1 text-readout-sm">
            {num1.format(p.windowConsumption)} <span className="text-dim">{p.unit}</span>
          </p>
          <p className="mt-1.5 text-xs text-dim">
            {num0.format(p.coveredDays)} von {num0.format(p.windowDays)} Tagen erfasst
          </p>
        </div>
      </div>

      {p.previousYearConsumption !== null && (
        <p className="text-xs text-dim">
          Vorjahr: {num1.format(p.previousYearConsumption)} {p.unit}
          {p.previousYearCost !== null ? ` · ${eur.format(p.previousYearCost)}` : ""}
        </p>
      )}

      <p className="text-xs text-dim">
        Gleitendes Jahr bis zur Ablesung vom {dateFmt.format(anchor)}.
      </p>
    </div>
  );
}

export interface ProjectionOverviewEntry {
  zaehlerId: string;
  name: string;
  kategorie: EnergyCategoryValue;
  farbe: string;
  projection: ConsumptionProjection;
}

/** Mehr-Zähler-Tabelle der Jahres-Hochrechnung (für /berichte). */
export function ProjectionOverview({ entries }: { entries: ProjectionOverviewEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-dim">Noch keine Zähler für eine Prognose vorhanden.</p>;
  }

  return (
    <TableScroll>
      <Table>
        <thead>
          <tr>
            <Th>Zähler</Th>
            <Th>Kategorie</Th>
            <Th>Methode</Th>
            <Th>Prognose Jahr</Th>
            <Th>vs. Vorjahr</Th>
            <Th>Geschätzte Kosten</Th>
            <Th>vs. Vorjahr</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const p = entry.projection;
            return (
              <tr key={entry.zaehlerId} className="last:[&>td]:border-0">
                <Td>
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="size-2.5 flex-none rounded-full"
                      style={{ background: entry.farbe }}
                    />
                    <span className="truncate">{entry.name}</span>
                  </span>
                </Td>
                <Td>
                  <Badge>{ENERGY_CATEGORY_LABELS[entry.kategorie]}</Badge>
                </Td>
                <Td>
                  {p.projectedAnnual === null ? "–" : <Badge>{METHOD_LABEL[p.method]}</Badge>}
                </Td>
                <Td className="whitespace-nowrap">
                  {p.projectedAnnual === null ? (
                    <span className="text-xs text-dim">zu wenige Daten</span>
                  ) : (
                    <span className="readout">
                      {num1.format(p.projectedAnnual)} {p.unit}
                    </span>
                  )}
                </Td>
                <Td>
                  <DeltaBadge pct={p.deltaConsumptionPct} />
                </Td>
                <Td className="readout whitespace-nowrap">
                  {p.projectedAnnualCost !== null ? eur.format(p.projectedAnnualCost) : "–"}
                </Td>
                <Td>
                  <DeltaBadge pct={p.deltaCostPct} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableScroll>
  );
}
