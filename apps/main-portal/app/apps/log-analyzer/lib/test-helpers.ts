import type { LogMeta, LogSeries, ParsedLog } from "./types";

// Tiny synthetic-log builder for unit tests. Lets a test declare just the
// channels it cares about (label + values) and fills in the derived fields
// (min/max/key/color/group placeholders) plus a computed meta block, so the
// pure engines can be exercised without going through the CSV parser.
//
// NOTE: this file is imported only from *.test.ts. It carries no runtime deps.

export interface ColumnSpec {
  label: string;
  unit?: string | null;
  values: (number | null)[];
  group?: string;
}

function extremum(values: (number | null)[], kind: "min" | "max"): number | null {
  let m: number | null = null;
  for (const v of values) {
    if (v === null) continue;
    if (m === null || (kind === "min" ? v < m : v > m)) m = v;
  }
  return m;
}

export function makeSeries(spec: ColumnSpec, idx: number): LogSeries {
  return {
    key: `${spec.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${idx}`,
    label: spec.label,
    unit: spec.unit ?? null,
    group: spec.group ?? "Other",
    color: "#868e96",
    values: spec.values,
    min: extremum(spec.values, "min"),
    max: extremum(spec.values, "max"),
  };
}

export function makeLog(columns: ColumnSpec[], time?: number[]): ParsedLog {
  const len = columns[0]?.values.length ?? 0;
  const t = time ?? Array.from({ length: len }, (_, i) => i);
  const series = columns.map((c, i) => makeSeries(c, i));

  const rpm = series.find((s) => /rpm/i.test(s.label));
  const boost = series.find((s) => /boost.*(actual|ist)/i.test(s.label)) ??
    series.find((s) => /boost/i.test(s.label));

  const meta: LogMeta = {
    vin: null,
    vehicle: null,
    mapVersion: null,
    software: null,
    date: null,
    peakBoost: boost?.max ?? null,
    peakBoostUnit: boost?.unit ?? null,
    maxRpm: rpm?.max ?? null,
    gearRange: null,
    duration: t.length >= 2 ? t[t.length - 1] - t[0] : null,
  };

  return {
    time: t,
    timeUnit: time ? "s" : "#",
    series,
    meta,
    rowCount: len,
    skippedRows: 0,
  };
}

/** A clean, verifiable full-throttle single-gear pull: 1000 → 7000 RPM. */
export function verifiedPullColumns(overrides: Partial<Record<string, (number | null)[]>> = {}): ColumnSpec[] {
  const n = 60;
  const rpm: number[] = [];
  const pedal: number[] = [];
  const gear: number[] = [];
  const boostTarget: number[] = [];
  const boostActual: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = i / (n - 1);
    rpm.push(Math.round(1000 + p * 6000));
    pedal.push(p < 0.05 ? 40 : 100);
    gear.push(3);
    const bt = Math.min(1, p * 3) * 20;
    boostTarget.push(+bt.toFixed(2));
    boostActual.push(+(bt - 0.5).toFixed(2));
  }
  return [
    { label: "RPM", values: overrides.rpm ?? rpm },
    { label: "Pedal", unit: "%", values: overrides.pedal ?? pedal },
    { label: "Gear", values: overrides.gear ?? gear },
    { label: "Boost Target", unit: "psi", values: overrides.boostTarget ?? boostTarget },
    { label: "Boost Actual", unit: "psi", values: overrides.boostActual ?? boostActual },
    { label: "STFT", unit: "%", values: overrides.stft ?? new Array(n).fill(0) },
    { label: "LTFT", unit: "%", values: overrides.ltft ?? new Array(n).fill(-1) },
    { label: "Ignition Correction", unit: "°", values: overrides.correction ?? new Array(n).fill(0) },
  ];
}
