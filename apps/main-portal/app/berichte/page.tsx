import {
  Badge,
  Card,
  Group,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertTriangle, IconChartLine } from "@tabler/icons-react";
import { ENERGY_CATEGORY_LABELS } from "@zaehlwerk/database/shared";
import { getConsumptionSummary, getProjectionSummary } from "../lib/zaehler-actions";
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
    <Stack gap="lg">
      <div>
        <Title order={2}>Berichte</Title>
        <Text c="dimmed" size="sm">
          Verbrauchsübersicht, flexible Exporte und Jahres-Hochrechnung je Zähler.
        </Text>
      </div>

      <ExportPanel meters={meters} />

      <Card withBorder radius="md" p="lg">
        <Group gap="xs" mb="sm">
          <IconChartLine size={18} stroke={1.6} />
          <Title order={4}>Verbrauchs-Hochrechnung</Title>
        </Group>
        <Text size="sm" c="dimmed" mb="md">
          Prognose des Jahresverbrauchs auf Basis der bisherigen Ablesungen — saisonal gewichtet bei
          Gas/PV, linear bei Strom/Wasser — mit Vergleich zum Vorjahr.
        </Text>
        <ProjectionOverview entries={projections} />
      </Card>

      <Card withBorder radius="md" p="lg">
        <Title order={4} mb="sm">
          Verbrauchsübersicht
        </Title>
        {summary.length === 0 ? (
          <Text size="sm" c="dimmed">
            Noch keine Zähler angelegt.
          </Text>
        ) : (
          <Table verticalSpacing="sm" fz="sm">
            <TableThead>
              <TableTr>
                <TableTh>Zähler</TableTh>
                <TableTh>Kategorie</TableTh>
                <TableTh>Ablesungen</TableTh>
                <TableTh>Verbrauch gesamt</TableTh>
                <TableTh>Ø / Tag</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {summary.map((entry) => (
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
                  <TableTd>{entry.readingCount}</TableTd>
                  <TableTd>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm">
                        {numberFormatter.format(entry.totalConsumption)} {entry.einheit}
                      </Text>
                      {entry.hasImplausibleData && (
                        <IconAlertTriangle
                          size={14}
                          color="var(--mantine-color-orange-6)"
                          aria-label="Enthält unplausible Intervalle"
                        />
                      )}
                    </Group>
                  </TableTd>
                  <TableTd>
                    {entry.avgPerDay !== null
                      ? `${perDayFormatter.format(entry.avgPerDay)} ${entry.einheit}`
                      : "–"}
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
