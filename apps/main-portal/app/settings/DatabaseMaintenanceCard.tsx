"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconDatabaseCog, IconEraser, IconTrashX, IconWand } from "@tabler/icons-react";
import type { DatabaseStats } from "@/app/lib/db-maintenance";
import type { LogRetentionPolicy } from "@/app/lib/settings";
import {
  runLogMaintenance,
  runOptimize,
  runVacuum,
  updateLogRetentionPolicy,
} from "@/app/lib/data-governance-actions";
import { formatBytes } from "@/app/lib/format";
import { Button } from "@/app/components/ui/Button";
import { Field, NumberInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { useToast } from "@/app/components/ui/Toast";
import { Divider } from "@/app/components/ui/primitives";

const numberFormatter = new Intl.NumberFormat("de-DE");

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="well p-3">
      <p className="legend-label">{label}</p>
      <p className="readout mt-1 text-readout-sm">{value}</p>
    </div>
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
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"vacuum" | "optimize" | "prune" | "policy" | null>(null);
  const [retentionDays, setRetentionDays] = useState<number>(logRetention.retentionDays);
  const [maxCount, setMaxCount] = useState<number>(logRetention.maxCount);
  const n = (value: number) => numberFormatter.format(value);

  function report(result: { success: boolean; message: string }) {
    toast.show({
      tone: result.success ? "ok" : "risk",
      title: result.success ? "Erledigt" : "Fehlgeschlagen",
      message: result.message,
    });
  }

  /** Every action here follows the same shape: mark busy, run, report, refresh. */
  function run(key: typeof busy, action: () => Promise<{ success: boolean; message: string }>) {
    setBusy(key);
    startTransition(async () => {
      report(await action());
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
    run("prune", runLogMaintenance);
  }

  return (
    <Panel
      title="Datenbank · Statistik & Wartung"
      icon={<IconDatabaseCog size={17} stroke={1.7} />}
      description={
        <>
          Überblick über Größe und Datenbestand der SQLite-Datenbank. Nach großen Löschaktionen
          gibt <strong className="text-ink">VACUUM</strong> ungenutzten Speicher frei;{" "}
          <strong className="text-ink">PRAGMA optimize</strong> aktualisiert die
          Abfrage-Statistiken.
        </>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
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
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending && busy !== "vacuum"}
          onClick={() => run("vacuum", runVacuum)}
        >
          <IconTrashX size={16} />
          {pending && busy === "vacuum" ? "Läuft…" : "VACUUM (Speicher freigeben)"}
        </Button>
        <Button
          disabled={pending && busy !== "optimize"}
          onClick={() => run("optimize", runOptimize)}
        >
          <IconWand size={16} />
          {pending && busy === "optimize" ? "Läuft…" : "PRAGMA optimize"}
        </Button>
      </div>

      <Divider className="my-6" />

      <h3 className="mb-1 text-sm font-semibold">Log-Aufbewahrung</h3>
      <p className="mb-4 text-sm text-dim">
        Die Roh-CSVs der Datalogs sind der mit Abstand größte Posten in der Datenbank und wachsen
        durch die automatische Übernahme (API / Watch-Ordner) unbegrenzt weiter.{" "}
        <strong className="text-ink">0 bedeutet unbegrenzt</strong> — es wird also nichts gelöscht,
        solange du keine Grenze setzt. Sind beide Grenzen gesetzt, greift die strengere. Aufgeräumt
        wird täglich automatisch; freigegebener Speicher wird per VACUUM an das Dateisystem
        zurückgegeben.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Aufbewahrung (Tage)" description="0 = unbegrenzt" className="w-44">
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
        <Field label="Maximale Anzahl Logs" description="0 = kein Limit" className="w-48">
          {({ id, describedBy }) => (
            <NumberInput
              id={id}
              aria-describedby={describedBy}
              min={0}
              max={100_000}
              value={maxCount}
              onChange={(event) => setMaxCount(Number(event.currentTarget.value) || 0)}
            />
          )}
        </Field>
        <Button
          variant="primary"
          disabled={pending && busy !== "policy"}
          onClick={() =>
            run("policy", () => updateLogRetentionPolicy({ retentionDays, maxCount }))
          }
        >
          {pending && busy === "policy" ? "Wird gespeichert…" : "Speichern"}
        </Button>
        <Button
          variant="danger"
          disabled={(pending && busy !== "prune") || (retentionDays === 0 && maxCount === 0)}
          onClick={prune}
        >
          <IconEraser size={16} />
          {pending && busy === "prune" ? "Räumt auf…" : "Jetzt aufräumen"}
        </Button>
      </div>

      {logRetention.lastRunAt && (
        <p className="mt-4 text-xs text-dim">
          Letzte automatische Wartung: {new Date(logRetention.lastRunAt).toLocaleString("de-DE")}
        </p>
      )}
    </Panel>
  );
}
