"use client";

import { Panel } from "@/app/components/ui/Panel";
import {
  IconClock,
  IconEngine,
  IconGauge,
  IconManualGearbox,
  IconWind,
} from "@tabler/icons-react";
import { KpiRail } from "@/app/components/ui/KpiRail";
import type { LogMeta } from "./lib/types";

// "At a glance" for an open log, split by how the numbers are used.
//
// The four *computed* highlights (peak boost, max RPM, gear range, duration) are
// what a tuner glances back at while scrubbing the charts, so they go into the
// sticky micro-KPI rail and stay pinned under the header at any scroll depth.
// The header *identity* fields (vehicle, VIN, map, date) are read once when the
// log opens and then never again — they stay in the card below.

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="legend-label">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium">{value}</p>
    </div>
  );
}

function fmt(value: string | null | undefined): string {
  return value && value.trim() !== "" ? value : "—";
}

export function MetadataCard({ meta, rowCount, skippedRows }: {
  meta: LogMeta;
  rowCount: number;
  skippedRows: number;
}) {
  const highlights = [
    {
      key: "boost",
      label: "Peak Boost",
      value:
        meta.peakBoost !== null
          ? `${meta.peakBoost}${meta.peakBoostUnit ? ` ${meta.peakBoostUnit}` : ""}`
          : "—",
      hint: "höchster Ladedruck",
      icon: <IconWind size={15} stroke={1.6} />,
    },
    {
      key: "rpm",
      label: "Max RPM",
      value: meta.maxRpm !== null ? meta.maxRpm.toLocaleString("de-DE") : "—",
      hint: "Drehzahlspitze",
      icon: <IconEngine size={15} stroke={1.6} />,
    },
    {
      key: "gear",
      label: "Gangbereich",
      value: meta.gearRange ? `${meta.gearRange[0]}–${meta.gearRange[1]}` : "—",
      hint: "im gesamten Log",
      icon: <IconManualGearbox size={15} stroke={1.6} />,
    },
    {
      key: "duration",
      label: "Dauer",
      value: meta.duration !== null ? `${meta.duration.toFixed(1)} s` : "—",
      hint: `${rowCount.toLocaleString("de-DE")} Datenzeilen`,
      icon: <IconClock size={15} stroke={1.6} />,
    },
  ];

  const identity: { label: string; value: string }[] = [
    { label: "Fahrzeug", value: fmt(meta.vehicle) },
    { label: "VIN", value: fmt(meta.vin) },
    { label: "Map-Version", value: fmt(meta.mapVersion) },
    { label: "Datum", value: fmt(meta.date) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <KpiRail items={highlights} columns={4} label="Log-Kennwerte" />

      <Panel title="Log-Metadaten" icon={<IconGauge size={17} stroke={1.7} />}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {identity.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} />
          ))}
        </div>
        {skippedRows > 0 && (
          <p className="mt-4 text-xs text-dim">{skippedRows} korrupte Zeile(n) übersprungen</p>
        )}
      </Panel>
    </div>
  );
}
