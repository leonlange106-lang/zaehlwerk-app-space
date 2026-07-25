// Shared, framework-free types for the Log Analyzer. Kept in their own
// module so both the pure parser (unit-tested), the API route (server) and the
// React views (client) can import them without pulling in any runtime deps.

/** Which Y axis a channel is plotted against within its group chart. */
export type AxisSide = "left" | "right";

/** A single named channel/parameter extracted from a datalog. */
export interface LogSeries {
  /** Stable, slugified id derived from the column label (unique per log). */
  key: string;
  /** Original human-readable column label from the log header. */
  label: string;
  /** Physical unit if the header carried one (e.g. "psi", "°C"), else null. */
  unit: string | null;
  /** Parameter group this channel belongs to (Boost Control, Fueling, …). */
  group: string;
  /** Deterministic chart colour for this channel. */
  color: string;
  /** One value per sample; null marks a gap (empty/corrupt cell). */
  values: (number | null)[];
  /** Precomputed min across non-null values (null if fully empty). */
  min: number | null;
  /** Precomputed max across non-null values (null if fully empty). */
  max: number | null;
}

/** Header metadata + a few computed highlights shown in the metadata card. */
export interface LogMeta {
  vin: string | null;
  vehicle: string | null;
  mapVersion: string | null;
  software: string | null;
  date: string | null;
  /** Peak boost (actual) if a boost channel is present, else null. */
  peakBoost: number | null;
  peakBoostUnit: string | null;
  /** Highest engine speed seen, if an RPM channel is present. */
  maxRpm: number | null;
  /** [minGear, maxGear] if a gear channel is present, else null. */
  gearRange: [number, number] | null;
  /** Log duration in seconds if a real time axis was found, else null. */
  duration: number | null;
}

/** The fully parsed, chart-ready representation of one datalog. */
export interface ParsedLog {
  /** X-axis samples (seconds when a real time column exists, else sample index). */
  time: number[];
  /** Unit of the x-axis: "s" for seconds, "#" for a synthetic sample index. */
  timeUnit: "s" | "#";
  series: LogSeries[];
  meta: LogMeta;
  /** Number of accepted data rows. */
  rowCount: number;
  /** Number of rows dropped as corrupt (wrong shape / unparseable x). */
  skippedRows: number;
}
