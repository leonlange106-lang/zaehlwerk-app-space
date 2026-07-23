"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  NumberInput,
  Stack,
  Switch,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconCheck,
  IconClockCog,
  IconDatabaseExport,
  IconDownload,
  IconTrash,
} from "@tabler/icons-react";
import type { SnapshotFile } from "@/app/lib/backup-engine";
import type { BackupPolicy } from "@/app/lib/settings";
import {
  createBackupNow,
  deleteBackup,
  updateBackupPolicy,
} from "@/app/lib/data-governance-actions";
import { formatBytes, formatDateTime } from "@/app/lib/format";

export function BackupPolicyCard({
  policy,
  snapshots,
}: {
  policy: BackupPolicy;
  snapshots: SnapshotFile[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [autoEnabled, setAutoEnabled] = useState(policy.autoEnabled);
  const [intervalHours, setIntervalHours] = useState<number>(policy.intervalHours);
  const [retentionDays, setRetentionDays] = useState<number>(policy.retentionDays);

  function toast(result: { success: boolean; message: string }) {
    notifications.show({
      color: result.success ? "green" : "red",
      icon: result.success ? <IconCheck size={16} /> : <IconAlertCircle size={16} />,
      message: result.message,
    });
  }

  function savePolicy() {
    setBusyAction("policy");
    startTransition(async () => {
      const result = await updateBackupPolicy({ autoEnabled, intervalHours, retentionDays });
      toast(result);
      setBusyAction(null);
      router.refresh();
    });
  }

  function backupNow() {
    setBusyAction("create");
    startTransition(async () => {
      const result = await createBackupNow();
      toast(result);
      setBusyAction(null);
      router.refresh();
    });
  }

  function remove(name: string) {
    if (!window.confirm(`Sicherung „${name}" wirklich löschen?`)) return;
    setBusyAction(name);
    startTransition(async () => {
      const result = await deleteBackup(name);
      toast(result);
      setBusyAction(null);
      router.refresh();
    });
  }

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm">
        <IconClockCog size={18} stroke={1.6} />
        <Title order={4}>Automatische Sicherungen &amp; Aufbewahrung</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Legt regelmäßig JSON- und SQLite-Snapshots im Speicher-Volume an und löscht alte automatisch
        nach Ablauf der Aufbewahrungsfrist. Für Offsite-Backups (Proxmox, Home Assistant) den
        Endpunkt <Code>POST /api/v1/system/backup</Code> mit <Code>Authorization: Bearer zw_pat_…</Code> ansteuern.
      </Text>

      <Stack gap="md">
        <Switch
          checked={autoEnabled}
          onChange={(event) => setAutoEnabled(event.currentTarget.checked)}
          label="Automatische Sicherungen aktivieren"
          description="Der Server prüft stündlich, ob laut Intervall eine neue Sicherung fällig ist."
        />

        <Group align="flex-end" gap="sm" wrap="wrap">
          <NumberInput
            label="Intervall (Stunden)"
            min={1}
            max={24 * 30}
            value={intervalHours}
            onChange={(value) => setIntervalHours(typeof value === "number" ? value : 24)}
            w={170}
            disabled={!autoEnabled}
          />
          <NumberInput
            label="Aufbewahrung (Tage)"
            description="0 = unbegrenzt aufbewahren"
            min={0}
            max={3650}
            value={retentionDays}
            onChange={(value) => setRetentionDays(typeof value === "number" ? value : 30)}
            w={200}
          />
          <Button color="slate" loading={pending && busyAction === "policy"} onClick={savePolicy}>
            Richtlinie speichern
          </Button>
        </Group>

        <Group gap="sm">
          <Button
            variant="light"
            color="slate"
            leftSection={<IconDatabaseExport size={16} />}
            loading={pending && busyAction === "create"}
            onClick={backupNow}
          >
            Jetzt sichern
          </Button>
          {policy.lastRunAt && (
            <Text size="xs" c="dimmed">
              Letzte Sicherung: {formatDateTime(policy.lastRunAt)}
            </Text>
          )}
        </Group>

        {snapshots.length === 0 ? (
          <Alert variant="light" color="slate" icon={<IconAlertCircle size={16} />}>
            Noch keine automatischen Sicherungen vorhanden.
          </Alert>
        ) : (
          <Table verticalSpacing="xs" fz="sm">
            <TableThead>
              <TableTr>
                <TableTh>Datei</TableTh>
                <TableTh>Typ</TableTh>
                <TableTh>Größe</TableTh>
                <TableTh>Erstellt</TableTh>
                <TableTh />
              </TableTr>
            </TableThead>
            <TableTbody>
              {snapshots.map((snapshot) => (
                <TableTr key={snapshot.name}>
                  <TableTd style={{ wordBreak: "break-all" }}>{snapshot.name}</TableTd>
                  <TableTd>
                    <Badge size="sm" variant="light" color={snapshot.kind === "sqlite" ? "grape" : "blue"}>
                      {snapshot.kind === "sqlite" ? "SQLite" : "JSON"}
                    </Badge>
                  </TableTd>
                  <TableTd>{formatBytes(snapshot.sizeBytes)}</TableTd>
                  <TableTd>{formatDateTime(snapshot.createdAt)}</TableTd>
                  <TableTd>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <Tooltip label="Herunterladen">
                        <ActionIcon
                          component="a"
                          href={`/api/v1/system/backup?file=${encodeURIComponent(snapshot.name)}`}
                          download
                          variant="subtle"
                          color="slate"
                        >
                          <IconDownload size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Löschen">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          loading={pending && busyAction === snapshot.name}
                          onClick={() => remove(snapshot.name)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        )}
      </Stack>
    </Card>
  );
}
