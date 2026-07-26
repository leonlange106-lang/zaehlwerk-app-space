import { getDatabaseStats } from "@/app/lib/db-maintenance";
import { getLogRetentionPolicy } from "@/app/lib/settings";
import { Panel } from "@/app/components/ui/Panel";
import { Divider } from "@/app/components/ui/primitives";
import { IconDatabase } from "@tabler/icons-react";
import Link from "next/link";

// Zustand der Datenbank — was sie WIEGT, nicht wie sie konfiguriert ist.
//
// Die Aufbewahrungs-Einstellungen bleiben bewusst drueben unter
// Plattform-Einstellungen: dort werden sie geaendert, hier nur beobachtet. Der
// Verweis unten schlaegt die Bruecke, statt dieselbe Karte zweimal zu bauen.

function fmtBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export async function AdminDatabaseSection() {
  const [stats, retention] = await Promise.all([getDatabaseStats(), getLogRetentionPolicy()]);

  return (
    <Panel title="Datenbank" icon={<IconDatabase size={17} stroke={1.7} />}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Dateigröße" value={fmtBytes(stats.sizeBytes)} />
        <Stat
          label="davon Roh-CSV"
          value={fmtBytes(stats.logCsvBytes)}
          hint={
            stats.sizeBytes && stats.logCsvBytes
              ? `${Math.round((stats.logCsvBytes / stats.sizeBytes) * 100)} % der Datei`
              : undefined
          }
        />
        <Stat label="Gespeicherte Logs" value={String(stats.counts.logFiles)} />
        <Stat label="Ablesungen" value={String(stats.counts.ablesungen)} />
        <Stat label="Zähler" value={String(stats.counts.zaehler)} />
        <Stat label="Benutzer" value={String(stats.counts.users)} />
        <Stat label="API-Token" value={String(stats.counts.tokens)} />
        <Stat label="Audit-Einträge" value={String(stats.counts.auditLogs)} />
        <Stat
          label="Log-Aufbewahrung"
          value={
            retention.retentionDays > 0 || retention.maxCount > 0
              ? [
                  retention.retentionDays > 0 ? `${retention.retentionDays} Tage` : null,
                  retention.maxCount > 0 ? `max. ${retention.maxCount}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "unbegrenzt"
          }
        />
      </div>

      <Divider className="my-4" />
      <p className="text-xs text-dim">
        Diese Seite zeigt den Zustand. Geändert werden Aufbewahrung und Wartung unter{" "}
        <Link href="/settings/daten" className="text-accent underline-offset-2 hover:underline">
          Daten &amp; Backup
        </Link>
        .
      </p>
    </Panel>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="legend-label">{label}</p>
      <p className="readout mt-0.5 text-sm">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-dim">{hint}</p>}
    </div>
  );
}
