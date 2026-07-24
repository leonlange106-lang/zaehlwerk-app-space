import {
  Badge,
  Group,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from "@mantine/core";
import { IconArrowDownRight, IconArrowUpRight, IconMinus } from "@tabler/icons-react";
import {
  ENERGY_CATEGORY_LABELS,
  type ConsumptionProjection,
  type EnergyCategoryValue,
} from "@zaehlwerk/database/shared";

const num0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const pct = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

const CONFIDENCE: Record<ConsumptionProjection["confidence"], { label: string; color: string }> = {
  low: { label: "wenig Daten", color: "gray" },
  medium: { label: "mittel", color: "blue" },
  high: { label: "hoch", color: "teal" },
};

const METHOD_LABEL: Record<ConsumptionProjection["method"], string> = {
  linear: "Linear",
  seasonal: "Saisonal",
};

/** Delta-Chip: Anstieg rot (mehr Verbrauch/Kosten), Rückgang grün. */
export function DeltaBadge({ pct: value }: { pct: number | null }) {
  if (value === null) {
    return (
      <Badge variant="light" color="gray" size="sm" leftSection={<IconMinus size={12} />}>
        n/a
      </Badge>
    );
  }
  const up = value > 0.05;
  const down = value < -0.05;
  const color = up ? "red" : down ? "teal" : "gray";
  const Icon = up ? IconArrowUpRight : down ? IconArrowDownRight : IconMinus;
  return (
    <Badge variant="light" color={color} size="sm" leftSection={<Icon size={12} />}>
      {pct.format(value)} %
    </Badge>
  );
}

/** Kompakte Kennzahlen einer einzelnen Jahres-Hochrechnung (für die Detailseite). */
export function ProjectionStats({ projection }: { projection: ConsumptionProjection }) {
  const p = projection;

  if (p.projectedAnnual === null) {
    return (
      <Text size="sm" c="dimmed">
        Noch zu wenige Ablesungen für eine belastbare Hochrechnung – es werden mindestens zwei
        Ablesungen im Abstand von einigen Wochen benötigt.
      </Text>
    );
  }

  // Die Hochrechnung bezieht sich auf das gleitende Jahr bis zur jüngsten
  // Ablesung, nicht auf das Kalenderjahr — bei einer reinen Jahresablesung ist
  // das exakt der zuletzt gemessene Jahresverbrauch.
  const anchor = new Date(p.anchorDate);

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge variant="light" color="slate" size="sm">
          {METHOD_LABEL[p.method]}
        </Badge>
        <Badge variant="dot" color={CONFIDENCE[p.confidence].color} size="sm">
          Konfidenz: {CONFIDENCE[p.confidence].label}
        </Badge>
      </Group>

      <Group gap="xl" align="flex-start" wrap="wrap">
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Hochrechnung / Jahr
          </Text>
          <Text fw={700} size="lg">
            {num1.format(p.projectedAnnual)} {p.unit}
          </Text>
          <Group gap={6} mt={2}>
            <Text size="xs" c="dimmed">
              vs. Vorjahr
            </Text>
            <DeltaBadge pct={p.deltaConsumptionPct} />
          </Group>
        </div>

        {p.projectedAnnualCost !== null && (
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Geschätzte Jahreskosten
            </Text>
            <Text fw={700} size="lg">
              {eur.format(p.projectedAnnualCost)}
            </Text>
            <Group gap={6} mt={2}>
              <Text size="xs" c="dimmed">
                vs. Vorjahr
              </Text>
              <DeltaBadge pct={p.deltaCostPct} />
            </Group>
          </div>
        )}

        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Letzte 12 Monate
          </Text>
          <Text fw={600}>
            {num1.format(p.windowConsumption)} {p.unit}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {num0.format(p.coveredDays)} von {num0.format(p.windowDays)} Tagen erfasst
          </Text>
        </div>
      </Group>

      {p.previousYearConsumption !== null && (
        <Text size="xs" c="dimmed">
          Vorjahr: {num1.format(p.previousYearConsumption)} {p.unit}
          {p.previousYearCost !== null ? ` · ${eur.format(p.previousYearCost)}` : ""}
        </Text>
      )}

      <Text size="xs" c="dimmed">
        Gleitendes Jahr bis zur Ablesung vom {dateFmt.format(anchor)}.
      </Text>
    </Stack>
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
    return (
      <Text size="sm" c="dimmed">
        Noch keine Zähler für eine Prognose vorhanden.
      </Text>
    );
  }

  return (
    <Table verticalSpacing="sm" fz="sm">
      <TableThead>
        <TableTr>
          <TableTh>Zähler</TableTh>
          <TableTh>Kategorie</TableTh>
          <TableTh>Methode</TableTh>
          <TableTh>Prognose Jahr</TableTh>
          <TableTh>vs. Vorjahr</TableTh>
          <TableTh>Geschätzte Kosten</TableTh>
          <TableTh>vs. Vorjahr</TableTh>
        </TableTr>
      </TableThead>
      <TableTbody>
        {entries.map((entry) => {
          const p = entry.projection;
          return (
            <TableTr key={entry.zaehlerId}>
              <TableTd>
                <Group gap="xs" wrap="nowrap">
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: entry.farbe,
                      flexShrink: 0,
                    }}
                  />
                  <Text size="sm">{entry.name}</Text>
                </Group>
              </TableTd>
              <TableTd>
                <Badge variant="light" color="slate" size="sm">
                  {ENERGY_CATEGORY_LABELS[entry.kategorie]}
                </Badge>
              </TableTd>
              <TableTd>
                {p.projectedAnnual === null ? (
                  "–"
                ) : (
                  <Badge variant="light" color="slate" size="sm">
                    {METHOD_LABEL[p.method]}
                  </Badge>
                )}
              </TableTd>
              <TableTd>
                {p.projectedAnnual === null ? (
                  <Text size="xs" c="dimmed">
                    zu wenige Daten
                  </Text>
                ) : (
                  <Text size="sm">
                    {num1.format(p.projectedAnnual)} {p.unit}
                  </Text>
                )}
              </TableTd>
              <TableTd>
                <DeltaBadge pct={p.deltaConsumptionPct} />
              </TableTd>
              <TableTd>
                {p.projectedAnnualCost !== null ? eur.format(p.projectedAnnualCost) : "–"}
              </TableTd>
              <TableTd>
                <DeltaBadge pct={p.deltaCostPct} />
              </TableTd>
            </TableTr>
          );
        })}
      </TableTbody>
    </Table>
  );
}
