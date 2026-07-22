import {
  Badge,
  Button,
  Card,
  Grid,
  GridCol,
  Group,
  List,
  ListItem,
  Progress,
  RingProgress,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowUpRight,
  IconClipboardList,
  IconServer2,
  IconStack2,
  IconUsers,
} from "@tabler/icons-react";
import classes from "./page.module.css";

const STATS = [
  {
    label: "Aktive Zählungen",
    value: "128",
    diff: "+12 diese Woche",
    icon: IconStack2,
  },
  {
    label: "Offene Aufgaben",
    value: "7",
    diff: "-3 seit gestern",
    icon: IconClipboardList,
  },
  {
    label: "Team Mitglieder",
    value: "16",
    diff: "+1 diesen Monat",
    icon: IconUsers,
  },
  {
    label: "Systemstatus",
    value: "Betriebsbereit",
    diff: "99.98% Uptime",
    icon: IconServer2,
  },
];

const RECENT_ACTIVITY = [
  { title: "Zählung „Halle 3“ abgeschlossen", meta: "vor 12 Minuten" },
  { title: "Neuer Nutzer eingeladen: j.schmidt@zaehlwerk.de", meta: "vor 48 Minuten" },
  { title: "Export „Q3 Bericht“ erstellt", meta: "vor 2 Stunden" },
  { title: "Wartungsfenster geplant für Sa. 02:00 Uhr", meta: "vor 5 Stunden" },
];

export default function DashboardPage() {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Dashboard</Title>
        <Text c="dimmed" size="sm">
          Überblick über Zählwerk-Systeme, Aktivitäten und Team.
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        {STATS.map((stat) => (
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
              <Button
                variant="subtle"
                color="slate"
                size="xs"
                rightSection={<IconArrowUpRight size={14} />}
              >
                Alle anzeigen
              </Button>
            </Group>
            <List spacing="sm" size="sm" listStyleType="none">
              {RECENT_ACTIVITY.map((entry) => (
                <ListItem key={entry.title} className={classes.activityItem}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm">{entry.title}</Text>
                    <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                      {entry.meta}
                    </Text>
                  </Group>
                </ListItem>
              ))}
            </List>
          </Card>
        </GridCol>

        <GridCol span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            <Card className={classes.panel}>
              <Title order={4} mb="sm">
                Systemauslastung
              </Title>
              <Group>
                <RingProgress
                  size={90}
                  thickness={9}
                  roundCaps
                  sections={[{ value: 62, color: "slate" }]}
                  label={
                    <Text ta="center" fw={600} size="sm">
                      62%
                    </Text>
                  }
                />
                <Stack gap={6} style={{ flex: 1 }}>
                  <div>
                    <Group justify="space-between" mb={2}>
                      <Text size="xs">CPU</Text>
                      <Text size="xs" c="dimmed">
                        41%
                      </Text>
                    </Group>
                    <Progress value={41} size="xs" color="slate" />
                  </div>
                  <div>
                    <Group justify="space-between" mb={2}>
                      <Text size="xs">Speicher</Text>
                      <Text size="xs" c="dimmed">
                        68%
                      </Text>
                    </Group>
                    <Progress value={68} size="xs" color="slate" />
                  </div>
                </Stack>
              </Group>
            </Card>

            <Card className={classes.panel}>
              <Group justify="space-between" mb="sm">
                <Title order={4}>Schnellzugriff</Title>
                <Badge variant="light" color="slate" size="sm">
                  Beta
                </Badge>
              </Group>
              <Stack gap="xs">
                <Button variant="light" color="slate" justify="start" fullWidth>
                  Neue Zählung starten
                </Button>
                <Button variant="light" color="slate" justify="start" fullWidth>
                  Bericht exportieren
                </Button>
                <Button variant="light" color="slate" justify="start" fullWidth>
                  Team einladen
                </Button>
              </Stack>
            </Card>
          </Stack>
        </GridCol>
      </Grid>
    </Stack>
  );
}
