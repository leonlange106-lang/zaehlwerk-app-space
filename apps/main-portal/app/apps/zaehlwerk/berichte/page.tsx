import { Badge } from "@/app/components/ui/Badge";
import { Panel } from "@/app/components/ui/Panel";
import { PageHeader, Table, TableScroll, Td, Th } from "@/app/components/ui/primitives";
import { IconAlertTriangle, IconChartLine } from "@tabler/icons-react";
import { ENERGY_CATEGORY_LABELS } from "@zaehlwerk/database/shared";
import { getConsumptionSummary, getProjectionSummary } from "@/app/lib/zaehler-actions";
import { ExportPanel } from "./ExportPanel";
import { ProjectionOverview } from "./projection-ui";

export const dynamic = "force-dynamic";

const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const perDayFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export default async function BerichtePage() {
  const [summary, projections] = await Promise.all([
    getConsumptionSummary(),
    getProjectionSummary(),
  ]);

  const meters = summary.map((entry) => ({ id: entry.zaehlerId, name: entry.name }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Berichte"
        description="Verbrauchsübersicht, flexible Exporte und Jahres-Hochrechnung je Zähler."
      />

      <ExportPanel meters={meters} />

      <Panel
        title="Verbrauchs-Hochrechnung"
        description="Prognose des Jahresverbrauchs auf Basis der bisherigen Ablesungen — saisonal gewichtet bei Gas/PV, linear bei Strom/Wasser — mit Vergleich zum Vorjahr."
        icon={<IconChartLine size={17} stroke={1.7} />}
      >
        <ProjectionOverview entries={projections} />
      </Panel>

      <Panel title="Verbrauchsübersicht" bare>
        {summary.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-dim">Noch keine Zähler angelegt.</p>
        ) : (
          <TableScroll className="pb-1">
            <Table>
              <thead>
                <tr>
                  <Th className="pl-5">Zähler</Th>
                  <Th>Kategorie</Th>
                  <Th>Ablesungen</Th>
                  <Th>Verbrauch gesamt</Th>
                  <Th className="pr-5">Ø / Tag</Th>
                </tr>
              </thead>
              <tbody>
                {summary.map((entry) => (
                  <tr key={entry.zaehlerId} className="last:[&>td]:border-0">
                    <Td className="pl-5">
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
                    <Td className="readout">{entry.readingCount}</Td>
                    <Td>
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="readout">
                          {numberFormatter.format(entry.totalConsumption)} {entry.einheit}
                        </span>
                        {entry.hasImplausibleData && (
                          <IconAlertTriangle
                            size={14}
                            className="text-watch"
                            aria-label="Enthält unplausible Intervalle"
                          />
                        )}
                      </span>
                    </Td>
                    <Td className="readout pr-5 whitespace-nowrap">
                      {entry.avgPerDay !== null
                        ? `${perDayFormatter.format(entry.avgPerDay)} ${entry.einheit}`
                        : "–"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Panel>
    </div>
  );
}
