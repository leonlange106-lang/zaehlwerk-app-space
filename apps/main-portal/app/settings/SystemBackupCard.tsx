"use client";

import { useState } from "react";
import { IconAlertCircle, IconCheck, IconDatabase, IconDownload, IconUpload } from "@tabler/icons-react";
import { restoreBackup, type RestoreMode } from "@/app/lib/backup-actions";
import { Button, ButtonLink } from "@/app/components/ui/Button";
import { Panel } from "@/app/components/ui/Panel";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import { Alert, FilePicker } from "@/app/components/ui/primitives";
import { cn } from "@/app/lib/cn";

const MODES: { value: RestoreMode; label: string; description: string }[] = [
  {
    value: "merge",
    label: "Fehlende Daten zusammenführen (Merge)",
    description: "Bestehende Datensätze bleiben erhalten; nur nicht vorhandene werden ergänzt.",
  },
  {
    value: "reset",
    label: "Daten überschreiben (Reset)",
    description: "Löscht ALLE aktuellen Daten und ersetzt sie vollständig durch das Backup.",
  },
];

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
    <Panel
      title="System-Sicherung"
      description="Vollständiges Backup aller Daten (Standorte, Zähler, Ablesungen, Tarife) als JSON — zum Sichern oder Umziehen auf eine andere Instanz."
      icon={<IconDatabase size={17} stroke={1.7} />}
    >
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/api/backup/download" download variant="primary">
          <IconDownload size={16} />
          Vollständiges Backup herunterladen
        </ButtonLink>
        <FilePicker
          accept="application/json,.json"
          onChange={(event) => void handlePick(event.currentTarget.files?.[0] ?? null)}
        >
          <IconUpload size={16} />
          Backup wiederherstellen
        </FilePicker>
      </div>

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
        opened={file !== null}
        onClose={() => setFile(null)}
        closeDisabled={busy}
        title="Backup wiederherstellen"
        size="sm"
        footer={
          <>
            <Button type="button" onClick={() => setFile(null)} disabled={busy}>
              Abbrechen
            </Button>
            <Button
              type="button"
              variant={mode === "reset" ? "danger" : "primary"}
              disabled={busy}
              onClick={handleConfirm}
            >
              {busy
                ? "Läuft…"
                : mode === "reset"
                  ? "Überschreiben"
                  : "Zusammenführen"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            Datei: <strong>{file?.name}</strong>
          </p>

          <fieldset>
            <legend className="mb-2 text-[13px] font-medium">Strategie</legend>
            <div className="flex flex-col gap-2">
              {MODES.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-control border p-3 transition-colors",
                    mode === option.value
                      ? "border-accent bg-[color-mix(in_srgb,var(--zw-accent)_8%,transparent)]"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  <input
                    type="radio"
                    name="restore-mode"
                    className="mt-0.5 size-4 flex-none accent-[var(--zw-accent)]"
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-dim">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {mode === "reset" && (
            <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
              Alle aktuellen Daten werden unwiderruflich gelöscht und durch das Backup ersetzt.
            </Alert>
          )}
        </div>
      </ResponsiveDialog>
    </Panel>
  );
}
