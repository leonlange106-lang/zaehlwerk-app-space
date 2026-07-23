"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconCheck, IconDatabaseCog, IconTrashX, IconWand } from "@tabler/icons-react";
import type { DatabaseStats } from "@/app/lib/db-maintenance";
import { runOptimize, runVacuum } from "@/app/lib/data-governance-actions";
import { formatBytes } from "@/app/lib/format";

const numberFormatter = new Intl.NumberFormat("de-DE");

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fw={700} fz="lg">
        {value}
      </Text>
    </Paper>
  );
}

export function DatabaseMaintenanceCard({ stats }: { stats: DatabaseStats }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"vacuum" | "optimize" | null>(null);
  const n = (value: number) => numberFormatter.format(value);

  function toast(result: { success: boolean; message: string }) {
    notifications.show({
      color: result.success ? "green" : "red",
      icon: result.success ? <IconCheck size={16} /> : <IconAlertCircle size={16} />,
      message: result.message,
    });
  }

  function vacuum() {
    setBusy("vacuum");
    startTransition(async () => {
      const result = await runVacuum();
      toast(result);
      setBusy(null);
      router.refresh();
    });
  }

  function optimize() {
    setBusy("optimize");
    startTransition(async () => {
      const result = await runOptimize();
      toast(result);
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm">
        <IconDatabaseCog size={18} stroke={1.6} />
        <Title order={4}>Datenbank · Statistik &amp; Wartung</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Überblick über Größe und Datenbestand der SQLite-Datenbank. Nach großen Löschaktionen gibt
        <Text span fw={600}> VACUUM </Text>
        ungenutzten Speicher frei; <Text span fw={600}>PRAGMA optimize</Text> aktualisiert die
        Abfrage-Statistiken.
      </Text>

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" mb="md">
        <Stat label="DB-Größe" value={formatBytes(stats.sizeBytes)} />
        <Stat label="Zähler" value={n(stats.counts.zaehler)} />
        <Stat label="Ablesungen" value={n(stats.counts.ablesungen)} />
        <Stat label="Tarife" value={n(stats.counts.tarife)} />
        <Stat label="Standorte" value={n(stats.counts.locations)} />
        <Stat label="Benutzer" value={n(stats.counts.users)} />
        <Stat label="API-Tokens" value={n(stats.counts.tokens)} />
        <Stat label="Audit-Einträge" value={n(stats.counts.auditLogs)} />
      </SimpleGrid>

      <Stack gap="sm">
        <Group gap="sm">
          <Button
            variant="light"
            color="slate"
            leftSection={<IconTrashX size={16} />}
            loading={pending && busy === "vacuum"}
            disabled={pending && busy !== "vacuum"}
            onClick={vacuum}
          >
            VACUUM (Speicher freigeben)
          </Button>
          <Button
            variant="light"
            color="slate"
            leftSection={<IconWand size={16} />}
            loading={pending && busy === "optimize"}
            disabled={pending && busy !== "optimize"}
            onClick={optimize}
          >
            PRAGMA optimize
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
