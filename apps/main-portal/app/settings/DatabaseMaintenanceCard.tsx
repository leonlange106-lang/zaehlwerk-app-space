"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconCheck,
  IconDatabaseCog,
  IconEraser,
  IconTrashX,
  IconWand,
} from "@tabler/icons-react";
import type { DatabaseStats } from "@/app/lib/db-maintenance";
import type { LogRetentionPolicy } from "@/app/lib/settings";
import {
  runLogMaintenance,
  runOptimize,
  runVacuum,
  updateLogRetentionPolicy,
} from "@/app/lib/data-governance-actions";
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

export function DatabaseMaintenanceCard({
  stats,
  logRetention,
}: {
  stats: DatabaseStats;
  logRetention: LogRetentionPolicy;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"vacuum" | "optimize" | "prune" | "policy" | null>(null);
  const [retentionDays, setRetentionDays] = useState<number>(logRetention.retentionDays);
  const [maxCount, setMaxCount] = useState<number>(logRetention.maxCount);
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

  function prune() {
    const scope =
      retentionDays > 0
        ? `älter als ${retentionDays} Tage`
        : `über die neuesten ${maxCount} hinaus`;
    if (!window.confirm(`Gespeicherte Logs ${scope} endgültig löschen?`)) return;
    setBusy("prune");
    startTransition(async () => {
      const result = await runLogMaintenance();
      toast(result);
      setBusy(null);
      router.refresh();
    });
  }

  function savePolicy() {
    setBusy("policy");
    startTransition(async () => {
      const result = await updateLogRetentionPolicy({ retentionDays, maxCount });
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
        <Stat label="Datalogs" value={n(stats.counts.logFiles)} />
        <Stat label="Davon Roh-CSV" value={formatBytes(stats.logCsvBytes)} />
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

      <Divider my="lg" />

      <Title order={5} mb={4}>
        Log-Aufbewahrung
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Die Roh-CSVs der Datalogs sind der mit Abstand größte Posten in der Datenbank und wachsen
        durch die automatische Übernahme (API / Watch-Ordner) unbegrenzt weiter.{" "}
        <Text span fw={600}>0 bedeutet unbegrenzt</Text> — es wird also nichts gelöscht, solange Sie
        keine Grenze setzen. Sind beide Grenzen gesetzt, greift die strengere. Aufgeräumt wird
        täglich automatisch; freigegebener Speicher wird per VACUUM an das Dateisystem
        zurückgegeben.
      </Text>

      <Group gap="sm" align="flex-end" wrap="wrap">
        <NumberInput
          label="Aufbewahrung (Tage)"
          description="0 = unbegrenzt"
          min={0}
          max={3650}
          w={170}
          value={retentionDays}
          onChange={(value) => setRetentionDays(typeof value === "number" ? value : 0)}
        />
        <NumberInput
          label="Maximale Anzahl Logs"
          description="0 = kein Limit"
          min={0}
          max={100_000}
          w={190}
          value={maxCount}
          onChange={(value) => setMaxCount(typeof value === "number" ? value : 0)}
        />
        <Button
          color="slate"
          loading={pending && busy === "policy"}
          disabled={pending && busy !== "policy"}
          onClick={savePolicy}
        >
          Speichern
        </Button>
        <Button
          variant="light"
          color="red"
          leftSection={<IconEraser size={16} />}
          loading={pending && busy === "prune"}
          disabled={(pending && busy !== "prune") || (retentionDays === 0 && maxCount === 0)}
          onClick={prune}
        >
          Jetzt aufräumen
        </Button>
      </Group>

      {logRetention.lastRunAt && (
        <Text size="xs" c="dimmed" mt="sm">
          Letzte automatische Wartung:{" "}
          {new Date(logRetention.lastRunAt).toLocaleString("de-DE")}
        </Text>
      )}
    </Card>
  );
}
