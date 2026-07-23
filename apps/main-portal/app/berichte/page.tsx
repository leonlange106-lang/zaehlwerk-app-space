import {
  Badge,
  Button,
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
import { IconAlertTriangle, IconDownload } from "@tabler/icons-react";
import { ENERGY_CATEGORY_LABELS } from "@zaehlwerk/database/shared";
import { getConsumptionSummary } from "../lib/zaehler-actions";

export const dynamic = "force-dynamic";

const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const perDayFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export default async function BerichtePage() {
  const summary = await getConsumptionSummary();

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>Berichte</Title>
          <Text c="dimmed" size="sm">
            Verbrauchsübersicht je Zähler und CSV-Export für die Buchhaltung oder externe Auswertung.
          </Text>
        </div>
        <Button component="a" href="/api/export" download color="slate" leftSection={<IconDownload size={16} />}>
          Alle Ablesungen exportieren
        </Button>
      </Group>

      <Card withBorder radius="md" p="lg">
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
                <TableTh />
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
                  <TableTd>
                    <Button
                      component="a"
                      href={`/api/export?zaehlerId=${entry.zaehlerId}`}
                      download
                      variant="subtle"
                      color="slate"
                      size="xs"
                      leftSection={<IconDownload size={14} />}
                    >
                      CSV
                    </Button>
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
