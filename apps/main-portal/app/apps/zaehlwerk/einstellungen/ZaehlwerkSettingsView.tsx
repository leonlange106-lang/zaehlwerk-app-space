"use client";

import Link from "next/link";
import { Anchor, Card, Group, List, ListItem, Stack, Text, Title } from "@mantine/core";
import { IconChartBar, IconReceipt2, IconStack2 } from "@tabler/icons-react";
import type { listLocations } from "@/app/lib/zaehler-actions";
import { LocationsCard } from "./LocationsCard";

type LocationList = Awaited<ReturnType<typeof listLocations>>;

export function ZaehlwerkSettingsView({ locations }: { locations: LocationList }) {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Zählwerk – Einstellungen</Title>
        <Text c="dimmed" size="sm">
          App-spezifische Konfiguration: Standorte & Zählergruppen, Tarife und Datenexporte.
          System- und Kontoeinstellungen liegen in den{" "}
          <Anchor component={Link} href="/settings">
            Plattform-Einstellungen
          </Anchor>
          .
        </Text>
      </div>

      <LocationsCard locations={locations} />

      <Card withBorder radius="md" p="lg">
        <Group gap="xs" mb="sm">
          <IconReceipt2 size={18} stroke={1.6} />
          <Title order={4}>Tarife</Title>
        </Group>
        <Text size="sm" c="dimmed">
          Tarife (Arbeits- & Grundpreis, MwSt) werden je Zähler gepflegt – öffne dazu einen Zähler
          und verwalte seine Tarifperioden direkt in der Detailansicht.
        </Text>
        <Anchor component={Link} href="/apps/zaehlwerk/zaehler" size="sm" mt={6} display="inline-block">
          Zu den Zählern →
        </Anchor>
      </Card>

      <Card withBorder radius="md" p="lg">
        <Group gap="xs" mb="sm">
          <IconChartBar size={18} stroke={1.6} />
          <Title order={4}>Exporte & Importe</Title>
        </Group>
        <Text size="sm" c="dimmed" mb="xs">
          App-Daten dieser Anwendung:
        </Text>
        <List spacing={4} size="sm" icon={<IconStack2 size={14} />}>
          <ListItem>
            CSV- und PDF-Exporte je Zähler und Zeitraum erstellst du unter{" "}
            <Anchor component={Link} href="/apps/zaehlwerk/berichte">
              Berichte
            </Anchor>
            .
          </ListItem>
          <ListItem>
            Zählerstände importierst du direkt beim jeweiligen Zähler (Detailansicht → Import) bzw.
            beim Anlegen eines Zählers.
          </ListItem>
        </List>
        <Text size="xs" c="dimmed" mt="sm">
          Vollständige System-Backups (gesamte Datenbank) findest du in den Plattform-Einstellungen.
        </Text>
      </Card>
    </Stack>
  );
}
