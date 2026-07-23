"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  FileButton,
  Group,
  Modal,
  Radio,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconDownload, IconUpload } from "@tabler/icons-react";
import { restoreBackup, type RestoreMode } from "@/app/lib/backup-actions";

export function SystemBackupCard() {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handlePick(picked: File | null) {
    setResult(null);
    if (!picked) return;
    setFile({ name: picked.name, text: await picked.text() });
  }

  async function handleConfirm() {
    if (!file) return;
    setBusy(true);
    const res = await restoreBackup(file.text, mode);
    setBusy(false);
    setResult({ ok: res.success, message: res.message });
    if (res.success) setFile(null);
  }

  return (
    <Card withBorder radius="md" p="lg">
      <Title order={4} mb="sm">
        System-Sicherung
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Vollständiges Backup aller Daten (Standorte, Zähler, Ablesungen, Tarife) als JSON — zum
        Sichern oder Umziehen auf eine andere Instanz.
      </Text>

      <Group>
        <Button
          component="a"
          href="/api/backup/download"
          download
          color="slate"
          leftSection={<IconDownload size={16} />}
        >
          Vollständiges Backup herunterladen
        </Button>
        <FileButton onChange={handlePick} accept="application/json,.json">
          {(props) => (
            <Button {...props} variant="light" color="slate" leftSection={<IconUpload size={16} />}>
              Backup wiederherstellen
            </Button>
          )}
        </FileButton>
      </Group>

      {result && (
        <Alert
          mt="md"
          variant="light"
          color={result.ok ? "green" : "red"}
          icon={result.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
        >
          {result.message}
        </Alert>
      )}

      <Modal
        opened={file !== null}
        onClose={() => !busy && setFile(null)}
        title="Backup wiederherstellen"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            Datei: <b>{file?.name}</b>
          </Text>
          <Radio.Group value={mode} onChange={(value) => setMode(value as RestoreMode)} label="Strategie">
            <Stack gap="xs" mt="xs">
              <Radio
                value="merge"
                label="Fehlende Daten zusammenführen (Merge)"
                description="Bestehende Datensätze bleiben erhalten; nur nicht vorhandene werden ergänzt."
              />
              <Radio
                value="reset"
                label="Daten überschreiben (Reset)"
                description="Löscht ALLE aktuellen Daten und ersetzt sie vollständig durch das Backup."
              />
            </Stack>
          </Radio.Group>

          {mode === "reset" && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              Alle aktuellen Daten werden unwiderruflich gelöscht und durch das Backup ersetzt.
            </Alert>
          )}

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setFile(null)} disabled={busy}>
              Abbrechen
            </Button>
            <Button color={mode === "reset" ? "red" : "slate"} loading={busy} onClick={handleConfirm}>
              {mode === "reset" ? "Überschreiben" : "Zusammenführen"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
