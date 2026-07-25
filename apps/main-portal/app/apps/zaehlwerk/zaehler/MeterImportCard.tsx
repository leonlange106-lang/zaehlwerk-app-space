"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  FileButton,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconFileImport } from "@tabler/icons-react";
import type { listLocations } from "@/app/lib/zaehler-actions";
import { importMeter, type LocationChoice } from "@/app/lib/backup-actions";

type LocationList = Awaited<ReturnType<typeof listLocations>>;

/**
 * Shape check for the file-picker preview only — deliberately NOT the Zod
 * schema. `importMeter` re-validates the same text with `meterExportSchema`
 * server-side and is the authority on what imports; running Zod here as well
 * bought nothing but pulled its whole runtime into the browser bundle.
 */
function previewOf(raw: unknown): { name: string; readings: number } | null {
  const data = (raw as { data?: unknown })?.data as
    | { zaehler?: { name?: unknown }; ablesungen?: unknown }
    | undefined;
  const name = data?.zaehler?.name;
  if (typeof name !== "string" || !Array.isArray(data?.ablesungen)) return null;
  return { name, readings: data.ablesungen.length };
}

export function MeterImportCard({ locations }: { locations: LocationList }) {
  const [preview, setPreview] = useState<{ name: string; readings: number; text: string } | null>(null);
  const [locValue, setLocValue] = useState<string>("none");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handlePick(picked: File | null) {
    setResult(null);
    if (!picked) return;
    const text = await picked.text();
    let preview: { name: string; readings: number } | null = null;
    try {
      preview = previewOf(JSON.parse(text));
    } catch {
      preview = null;
    }
    if (!preview) {
      setResult({ ok: false, message: "Keine gültige Zähler-Export-Datei." });
      return;
    }
    setPreview({ ...preview, text });
    setLocValue("none");
  }

  async function handleConfirm() {
    if (!preview) return;
    let choice: LocationChoice;
    if (locValue === "none") choice = { type: "none" };
    else if (locValue === "new") choice = { type: "new", name: newName.trim() || "Importierter Standort" };
    else choice = { type: "existing", id: locValue };

    setBusy(true);
    const res = await importMeter(preview.text, choice);
    setBusy(false);
    setResult({ ok: res.success, message: res.message });
    if (res.success) setPreview(null);
  }

  const options = [
    { value: "none", label: "Kein Standort" },
    { value: "new", label: "Neuen Standort anlegen …" },
    ...locations.map((location) => ({ value: location.id, label: location.name })),
  ];

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm">
        <IconFileImport size={18} stroke={1.6} />
        <Title order={4}>Zähler importieren</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Einzelnen Zähler aus einer JSON-Export-Datei importieren (inkl. Ablesungen und Tarife).
      </Text>

      <FileButton onChange={handlePick} accept="application/json,.json">
        {(props) => (
          <Button {...props} variant="light" color="slate" leftSection={<IconFileImport size={16} />}>
            Zähler-Datei wählen
          </Button>
        )}
      </FileButton>

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

      <Modal opened={preview !== null} onClose={() => !busy && setPreview(null)} title="Zähler importieren" centered>
        <Stack gap="sm">
          <Text size="sm">
            Zähler <b>{preview?.name}</b> mit {preview?.readings} Ablesungen. Es werden neue IDs
            vergeben (Import als Kopie).
          </Text>
          <Select label="Standort zuordnen" data={options} value={locValue} onChange={(v) => setLocValue(v ?? "none")} />
          {locValue === "new" && (
            <TextInput
              label="Name des neuen Standorts"
              placeholder="z. B. Ferienhaus"
              value={newName}
              onChange={(event) => setNewName(event.currentTarget.value)}
            />
          )}
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setPreview(null)} disabled={busy}>
              Abbrechen
            </Button>
            <Button color="slate" loading={busy} onClick={handleConfirm}>
              Importieren
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
