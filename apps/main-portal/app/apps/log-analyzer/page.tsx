import { Badge, Card, Group, List, ListItem, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconArrowLeft, IconChartHistogram, IconClock } from "@tabler/icons-react";
import { LinkButton } from "@/app/LinkButton";

export const metadata = {
  title: "MGflasher Log Analyzer – App Space",
};

// Placeholder / scaffolding for the upcoming MGflasher Log Analyzer app. The
// route exists so the launcher tile and app-switcher can already link here and
// the App-Space structure (/apps/<app>) is established.
export default function LogAnalyzerPage() {
  return (
    <Stack gap="lg" maw={760} mx="auto">
      <Group gap="md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-log-analyzer.svg" alt="" width={56} height={56} />
        <div>
          <Group gap="sm">
            <Title order={2}>MGflasher Log Analyzer</Title>
            <Badge variant="light" color="orange">
              In Vorbereitung
            </Badge>
          </Group>
          <Text c="dimmed" size="sm">
            Fahrzeug-Datenlogs auswerten & visualisieren.
          </Text>
        </div>
      </Group>

      <Card withBorder radius="md" p="xl">
        <Group gap="xs" mb="sm">
          <ThemeIcon variant="light" color="orange" radius="md" size={34}>
            <IconClock size={19} stroke={1.6} />
          </ThemeIcon>
          <Title order={4}>Diese App ist noch nicht verfügbar</Title>
        </Group>
        <Text size="sm" c="dimmed" mb="md">
          Der Log Analyzer wird als eigenständige App im App Space bereitgestellt. Geplanter
          Funktionsumfang:
        </Text>
        <List
          spacing="xs"
          size="sm"
          icon={
            <ThemeIcon variant="light" color="orange" size={20} radius="xl">
              <IconChartHistogram size={13} />
            </ThemeIcon>
          }
        >
          <ListItem>Import von MGflasher-Datenlogs (CSV).</ListItem>
          <ListItem>Interaktive Diagramme für Boost, AFR, Timing, Zündwinkel u. a.</ListItem>
          <ListItem>Vergleich mehrerer Logs und Marker für Auffälligkeiten.</ListItem>
        </List>

        <LinkButton
          href="/"
          variant="light"
          color="slate"
          mt="xl"
          leftSection={<IconArrowLeft size={16} />}
        >
          Zurück zum App Space
        </LinkButton>
      </Card>
    </Stack>
  );
}
