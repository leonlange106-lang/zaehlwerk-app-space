import {
  Badge,
  Card,
  Grid,
  GridCol,
  Group,
  List,
  ListItem,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowUpRight,
  IconCalendarStats,
  IconClipboardList,
  IconMapPin,
  IconStack2,
} from "@tabler/icons-react";
import { LinkButton } from "@/app/LinkButton";
import {
  getConsumptionSummary,
  listLocations,
  listRecentAblesungen,
  listZaehler,
} from "@/app/lib/zaehler-actions";
import classes from "./page.module.css";

// Reads live data from the database on every request — must not be
// statically prerendered at build time (there's no reachable DB then, and a
// static snapshot would go stale the moment someone adds a reading).
export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days < 30) return `vor ${days} Tag${days === 1 ? "" : "en"}`;
  return dateFormatter.format(date);
}

export default async function DashboardPage() {
  const [zaehlerList, locations, recentAblesungen, consumptionSummary] = await Promise.all([
    listZaehler(),
    listLocations(),
    listRecentAblesungen(6),
    getConsumptionSummary(),
  ]);

  const totalAblesungen = zaehlerList.reduce((sum, zaehler) => sum + zaehler.ablesungen.length, 0);
  const lastReadingDate = recentAblesungen[0]?.datum ?? null;

  const stats = [
    {
      label: "Aktive Zähler",
      value: String(zaehlerList.length),
      diff: "Strom, Gas, Wasser & mehr",
      icon: IconStack2,
    },
    {
      label: "Standorte",
      value: String(locations.length),
      diff: "erfasste Gebäude/Einheiten",
      icon: IconMapPin,
    },
    {
      label: "Ablesungen erfasst",
      value: String(totalAblesungen),
      diff: "über alle Zähler",
      icon: IconClipboardList,
    },
    {
      label: "Letzte Ablesung",
      value: lastReadingDate ? dateFormatter.format(lastReadingDate) : "–",
      diff: lastReadingDate ? formatRelative(lastReadingDate) : "noch keine Daten",
      icon: IconCalendarStats,
    },
  ];

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Dashboard</Title>
        <Text c="dimmed" size="sm">
          Überblick über Zählwerk-Systeme, Aktivitäten und Team.
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        {stats.map((stat) => (
          <Card key={stat.label} className={classes.statCard}>
            <Group justify="space-between" align="flex-start">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {stat.label}
              </Text>
              <stat.icon size={18} stroke={1.6} className={classes.statIcon} />
            </Group>
            <Text fw={700} size="xl" mt={4}>
              {stat.value}
            </Text>
            <Text size="xs" c="dimmed" mt={2}>
              {stat.diff}
            </Text>
          </Card>
        ))}
      </SimpleGrid>

      <Grid gutter="md">
        <GridCol span={{ base: 12, lg: 8 }}>
          <Card className={classes.panel} h="100%">
            <Group justify="space-between" mb="sm">
              <Title order={4}>Letzte Aktivität</Title>
              <LinkButton
                href="/apps/zaehlwerk/zaehler"
                variant="subtle"
                color="slate"
                size="xs"
                rightSection={<IconArrowUpRight size={14} />}
              >
                Alle anzeigen
              </LinkButton>
            </Group>
            {recentAblesungen.length === 0 ? (
              <Text size="sm" c="dimmed">
                Noch keine Ablesungen erfasst.
              </Text>
            ) : (
              <List spacing="sm" size="sm" listStyleType="none">
                {recentAblesungen.map((ablesung) => (
                  <ListItem key={ablesung.id} className={classes.activityItem}>
                    <Group justify="space-between" wrap="nowrap">
                      <Text size="sm">
                        {ablesung.zaehler.name}: {numberFormatter.format(ablesung.wert)}{" "}
                        {ablesung.zaehler.einheit}
                      </Text>
                      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                        {formatRelative(ablesung.datum)}
                      </Text>
                    </Group>
                  </ListItem>
                ))}
              </List>
            )}
          </Card>
        </GridCol>

        <GridCol span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            <Card className={classes.panel}>
              <Title order={4} mb="sm">
                Verbrauch je Zähler
              </Title>
              {consumptionSummary.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Noch keine Zähler angelegt.
                </Text>
              ) : (
                <Stack gap="xs">
                  {consumptionSummary.map((entry) => (
                    <Group key={entry.zaehlerId} justify="space-between" wrap="nowrap">
                      <Group gap="xs" wrap="nowrap">
                        <span className={classes.colorDot} style={{ background: entry.farbe }} />
                        <Text size="sm">{entry.name}</Text>
                      </Group>
                      <Text size="sm" fw={600} style={{ whiteSpace: "nowrap" }}>
                        {numberFormatter.format(entry.totalConsumption)} {entry.einheit}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </Card>

            <Card className={classes.panel}>
              <Group justify="space-between" mb="sm">
                <Title order={4}>Schnellzugriff</Title>
                <Badge variant="light" color="slate" size="sm">
                  Beta
                </Badge>
              </Group>
              <Stack gap="xs">
                <LinkButton href="/apps/zaehlwerk/zaehler" variant="light" color="slate" justify="start" fullWidth>
                  Neuen Zähler anlegen
                </LinkButton>
                <LinkButton href="/apps/zaehlwerk/zaehler" variant="light" color="slate" justify="start" fullWidth>
                  Zählerstand erfassen
                </LinkButton>
                <LinkButton href="/apps/zaehlwerk/zaehler" variant="light" color="slate" justify="start" fullWidth>
                  Alle Zähler anzeigen
                </LinkButton>
              </Stack>
            </Card>
          </Stack>
        </GridCol>
      </Grid>
    </Stack>
  );
}
