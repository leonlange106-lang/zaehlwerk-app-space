"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/Button";
import { Field, Select, SelectShell, TextInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import { Alert, FilePicker } from "@/app/components/ui/primitives";
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
    <Panel
      title="Zähler importieren"
      icon={<IconFileImport size={17} stroke={1.7} />}
      description="Einzelnen Zähler aus einer JSON-Export-Datei importieren (inkl. Ablesungen und Tarife)."
    >
      <FilePicker
        accept="application/json,.json"
        onChange={(event) => void handlePick(event.currentTarget.files?.[0] ?? null)}
      >
        <IconFileImport size={16} />
        Zähler-Datei wählen
      </FilePicker>

      {result && (
        <Alert
          className="mt-4"
          tone={result.ok ? "ok" : "risk"}
          role={result.ok ? "status" : "alert"}
          icon={result.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
        >
          {result.message}
        </Alert>
      )}

      <ResponsiveDialog
        opened={preview !== null}
        onClose={() => setPreview(null)}
        closeDisabled={busy}
        title="Zähler importieren"
        size="sm"
        footer={
          <>
            <Button type="button" onClick={() => setPreview(null)} disabled={busy}>
              Abbrechen
            </Button>
            <Button type="button" variant="primary" disabled={busy} onClick={handleConfirm}>
              {busy ? "Wird importiert…" : "Importieren"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            Zähler <strong>{preview?.name}</strong> mit {preview?.readings} Ablesungen. Es werden
            neue IDs vergeben (Import als Kopie).
          </p>
          <Field label="Standort zuordnen">
            {({ id }) => (
              <SelectShell>
                <Select
                  id={id}
                  value={locValue}
                  onChange={(event) => setLocValue(event.currentTarget.value)}
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </SelectShell>
            )}
          </Field>
          {locValue === "new" && (
            <Field label="Name des neuen Standorts">
              {({ id }) => (
                <TextInput
                  id={id}
                  placeholder="z. B. Ferienhaus"
                  value={newName}
                  onChange={(event) => setNewName(event.currentTarget.value)}
                />
              )}
            </Field>
          )}
        </div>
      </ResponsiveDialog>
    </Panel>
  );
}
