"use client";

import { Card, Group, SimpleGrid, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import {
  IconClock,
  IconEngine,
  IconGauge,
  IconManualGearbox,
  IconWind,
} from "@tabler/icons-react";
import { KpiRail } from "@/app/components/ui/KpiRail";
import type { LogMeta } from "./lib/types";

// "At a glance" for an open log, split by how the numbers are used.
//
// The four *computed* highlights (peak boost, max RPM, gear range, duration) are
// what a tuner glances back at while scrubbing the charts, so they go into the
// sticky micro-KPI rail and stay pinned under the header at any scroll depth.
// The header *identity* fields (vehicle, VIN, map, date) are read once when the
// log opens and then never again — they stay in the card below.

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
  const highlights = [
    {
      key: "boost",
      label: "Peak Boost",
      value:
        meta.peakBoost !== null
          ? `${meta.peakBoost}${meta.peakBoostUnit ? ` ${meta.peakBoostUnit}` : ""}`
          : "—",
      hint: "höchster Ladedruck",
      icon: <IconWind size={15} stroke={1.6} />,
    },
    {
      key: "rpm",
      label: "Max RPM",
      value: meta.maxRpm !== null ? meta.maxRpm.toLocaleString("de-DE") : "—",
      hint: "Drehzahlspitze",
      icon: <IconEngine size={15} stroke={1.6} />,
    },
    {
      key: "gear",
      label: "Gangbereich",
      value: meta.gearRange ? `${meta.gearRange[0]}–${meta.gearRange[1]}` : "—",
      hint: "im gesamten Log",
      icon: <IconManualGearbox size={15} stroke={1.6} />,
    },
    {
      key: "duration",
      label: "Dauer",
      value: meta.duration !== null ? `${meta.duration.toFixed(1)} s` : "—",
      hint: `${rowCount.toLocaleString("de-DE")} Datenzeilen`,
      icon: <IconClock size={15} stroke={1.6} />,
    },
  ];

  const identity: { label: string; value: string }[] = [
    { label: "Fahrzeug", value: fmt(meta.vehicle) },
    { label: "VIN", value: fmt(meta.vin) },
    { label: "Map-Version", value: fmt(meta.mapVersion) },
    { label: "Datum", value: fmt(meta.date) },
  ];

  return (
    <Stack gap="xs">
      <KpiRail items={highlights} columns={4} label="Log-Kennwerte" />

      <Card p="md">
        <Group gap="xs" mb="sm">
          <ThemeIcon variant="light" color="orange" radius="sm" size={28}>
            <IconGauge size={16} stroke={1.6} />
          </ThemeIcon>
          <Title order={5}>Log-Metadaten</Title>
        </Group>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          {identity.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} />
          ))}
        </SimpleGrid>
        {skippedRows > 0 && (
          <Text size="xs" c="dimmed" mt="sm">
            {skippedRows} korrupte Zeile(n) übersprungen
          </Text>
        )}
      </Card>
    </Stack>
  );
}
