"use client";

import { Card, Group, SimpleGrid, Text, ThemeIcon, Title } from "@mantine/core";
import { IconGauge } from "@tabler/icons-react";
import type { LogMeta } from "./lib/types";

// Compact "at a glance" card: extracted header fields (VIN, map, vehicle, date)
// plus computed highlights (peak boost, max RPM, gear range, duration).

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} lh={1.3}>
        {label}
      </Text>
      <Text size="sm" fw={500} style={{ wordBreak: "break-word" }}>
        {value}
      </Text>
    </div>
  );
}

function fmt(value: string | null | undefined): string {
  return value && value.trim() !== "" ? value : "—";
}

export function MetadataCard({ meta, rowCount, skippedRows }: {
  meta: LogMeta;
  rowCount: number;
  skippedRows: number;
}) {
  const stats: { label: string; value: string }[] = [
    { label: "Fahrzeug", value: fmt(meta.vehicle) },
    { label: "VIN", value: fmt(meta.vin) },
    { label: "Map-Version", value: fmt(meta.mapVersion) },
    { label: "Datum", value: fmt(meta.date) },
    {
      label: "Peak Boost",
      value: meta.peakBoost !== null ? `${meta.peakBoost}${meta.peakBoostUnit ? ` ${meta.peakBoostUnit}` : ""}` : "—",
    },
    { label: "Max RPM", value: meta.maxRpm !== null ? meta.maxRpm.toLocaleString("de-DE") : "—" },
    {
      label: "Gangbereich",
      value: meta.gearRange ? `${meta.gearRange[0]}–${meta.gearRange[1]}` : "—",
    },
    {
      label: "Dauer",
      value: meta.duration !== null ? `${meta.duration.toFixed(1)} s` : "—",
    },
  ];

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="md">
        <ThemeIcon variant="light" color="orange" radius="md" size={30}>
          <IconGauge size={17} stroke={1.6} />
        </ThemeIcon>
        <Title order={5}>Log-Metadaten</Title>
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        {stats.map((s) => (
          <Stat key={s.label} label={s.label} value={s.value} />
        ))}
      </SimpleGrid>
      <Text size="xs" c="dimmed" mt="md">
        {rowCount.toLocaleString("de-DE")} Datenzeilen
        {skippedRows > 0 ? ` · ${skippedRows} korrupte Zeile(n) übersprungen` : ""}
      </Text>
    </Card>
  );
}
