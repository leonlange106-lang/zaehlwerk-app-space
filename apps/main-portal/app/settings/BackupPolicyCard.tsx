"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconAlertCircle,
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
import { Badge } from "@/app/components/ui/Badge";
import { Button, ButtonLink } from "@/app/components/ui/Button";
import { Field, NumberInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { Tooltip } from "@/app/components/ui/Tooltip";
import { useToast } from "@/app/components/ui/Toast";
import { Alert, Code, Switch, Table, TableScroll, Td, Th } from "@/app/components/ui/primitives";

export function BackupPolicyCard({
  policy,
  snapshots,
}: {
  policy: BackupPolicy;
  snapshots: SnapshotFile[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [autoEnabled, setAutoEnabled] = useState(policy.autoEnabled);
  const [intervalHours, setIntervalHours] = useState<number>(policy.intervalHours);
  const [retentionDays, setRetentionDays] = useState<number>(policy.retentionDays);

  function report(result: { success: boolean; message: string }) {
    toast.show({
      tone: result.success ? "ok" : "risk",
      title: result.success ? "Erledigt" : "Fehlgeschlagen",
      message: result.message,
    });
  }

  function savePolicy() {
    setBusyAction("policy");
    startTransition(async () => {
      report(await updateBackupPolicy({ autoEnabled, intervalHours, retentionDays }));
      setBusyAction(null);
      router.refresh();
    });
  }

  function backupNow() {
    setBusyAction("create");
    startTransition(async () => {
      report(await createBackupNow());
      setBusyAction(null);
      router.refresh();
    });
  }

  function remove(name: string) {
    if (!window.confirm(`Sicherung „${name}" wirklich löschen?`)) return;
    setBusyAction(name);
    startTransition(async () => {
      report(await deleteBackup(name));
      setBusyAction(null);
      router.refresh();
    });
  }

  return (
    <Panel
      title="Automatische Sicherungen & Aufbewahrung"
      icon={<IconClockCog size={17} stroke={1.7} />}
      description={
        <>
          Legt regelmäßig JSON- und SQLite-Snapshots im Speicher-Volume an und löscht alte
          automatisch nach Ablauf der Aufbewahrungsfrist. Für Offsite-Backups (Proxmox, Home
          Assistant) den Endpunkt <Code>POST /api/v1/system/backup</Code> mit{" "}
          <Code>Authorization: Bearer zw_pat_…</Code> ansteuern.
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Switch
          checked={autoEnabled}
          onChange={setAutoEnabled}
          label="Automatische Sicherungen aktivieren"
          description="Der Server prüft stündlich, ob laut Intervall eine neue Sicherung fällig ist."
        />

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Intervall (Stunden)" className="w-44">
            {({ id }) => (
              <NumberInput
                id={id}
                min={1}
                max={24 * 30}
                value={intervalHours}
                onChange={(event) => setIntervalHours(Number(event.currentTarget.value) || 24)}
                disabled={!autoEnabled}
              />
            )}
          </Field>
          <Field
            label="Aufbewahrung (Tage)"
            description="0 = unbegrenzt aufbewahren"
            className="w-52"
          >
            {({ id, describedBy }) => (
              <NumberInput
                id={id}
                aria-describedby={describedBy}
                min={0}
                max={3650}
                value={retentionDays}
                onChange={(event) => setRetentionDays(Number(event.currentTarget.value) || 0)}
              />
            )}
          </Field>
          <Button
            variant="primary"
            disabled={pending && busyAction === "policy"}
            onClick={savePolicy}
          >
            {pending && busyAction === "policy" ? "Wird gespeichert…" : "Richtlinie speichern"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending && busyAction === "create"} onClick={backupNow}>
            <IconDatabaseExport size={16} />
            {pending && busyAction === "create" ? "Wird gesichert…" : "Jetzt sichern"}
          </Button>
          {policy.lastRunAt && (
            <p className="text-xs text-dim">
              Letzte Sicherung: {formatDateTime(policy.lastRunAt)}
            </p>
          )}
        </div>

        {snapshots.length === 0 ? (
          <Alert icon={<IconAlertCircle size={16} />}>
            Noch keine automatischen Sicherungen vorhanden.
          </Alert>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>Datei</Th>
                  <Th>Typ</Th>
                  <Th>Größe</Th>
                  <Th>Erstellt</Th>
                  <Th className="text-right">Aktionen</Th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => (
                  <tr key={snapshot.name} className="last:[&>td]:border-0">
                    <Td className="break-all font-mono text-[12px]">{snapshot.name}</Td>
                    <Td>
                      <Badge>{snapshot.kind === "sqlite" ? "SQLite" : "JSON"}</Badge>
                    </Td>
                    <Td className="readout whitespace-nowrap">{formatBytes(snapshot.sizeBytes)}</Td>
                    <Td className="whitespace-nowrap text-dim">
                      {formatDateTime(snapshot.createdAt)}
                    </Td>
                    <Td>
                      <span className="flex justify-end gap-1">
                        <Tooltip label="Herunterladen">
                          <ButtonLink
                            href={`/api/v1/system/backup?file=${encodeURIComponent(snapshot.name)}`}
                            download
                            variant="ghost"
                            size="sm"
                            aria-label={`Sicherung „${snapshot.name}" herunterladen`}
                          >
                            <IconDownload size={16} />
                          </ButtonLink>
                        </Tooltip>
                        <Tooltip label="Löschen">
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={pending && busyAction === snapshot.name}
                            aria-label={`Sicherung „${snapshot.name}" löschen`}
                            onClick={() => remove(snapshot.name)}
                          >
                            <IconTrash size={16} />
                          </Button>
                        </Tooltip>
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </div>
    </Panel>
  );
}
