import { colorForLabel, groupForLabel } from "./parameters";
import type { LogMeta, LogSeries, ParsedLog } from "./types";

// Robust, dependency-free parser for MGflasher-style ECU/TCU datalogs (CSV).
//
// It tolerates the real-world messiness of exported logs:
//  - delimiter auto-detection (comma / semicolon / tab),
//  - an optional leading metadata block (`# Key: Value` comment lines),
//  - units embedded in headers, e.g. `Boost Actual (psi)` → label + unit,
//  - German decimal commas (`1,23`) alongside dot decimals,
//  - a time column under several common names, or a synthetic sample index,
//  - corrupt/short/garbage rows, which are skipped and counted rather than
//    aborting the whole parse.

const TIME_HEADER = /^(time|zeit|timestamp|zeitstempel|sekunden|seconds|t)\b/i;
const RPM_HEADER = /rpm|drehzahl/i;
const BOOST_HEADER = /boost/i;
const GEAR_HEADER = /gear|gang/i;

/** Split a raw file into metadata comment lines and body lines. */
function splitBlocks(input: string): { metaLines: string[]; bodyLines: string[] } {
  const withoutBom = input.replace(/^﻿/, "");
  const lines = withoutBom.split(/\r?\n/);
  const metaLines: string[] = [];
  let i = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (line.startsWith("#")) {
      metaLines.push(line.replace(/^#\s?/, ""));
      continue;
    }
    break;
  }
  return { metaLines, bodyLines: lines.slice(i) };
}

/** Pick the delimiter that yields the most columns on the header line. */
function detectDelimiter(headerLine: string): string {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const delim of candidates) {
    const count = splitLine(headerLine, delim).length;
    if (count > bestCount) {
      bestCount = count;
      best = delim;
    }
  }
  return best;
}

/** Split one CSV line on `delim`, honouring double-quoted fields with "" escapes. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

/** Extract a trailing `(unit)` / `[unit]` from a header cell → { label, unit }. */
function splitHeaderUnit(raw: string): { label: string; unit: string | null } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*?)[\s]*[([]([^)\]]+)[)\]]\s*$/);
  if (match && match[1].trim() !== "") {
    return { label: match[1].trim(), unit: match[2].trim() };
  }
  return { label: trimmed, unit: null };
}

/** Factor that converts a time column's unit into seconds (defaults to 1). */
function timeUnitScale(unit: string | null): number {
  if (!unit) return 1;
  const u = unit.trim().toLowerCase();
  if (u === "ms" || u.includes("milli")) return 1e-3;
  if (u === "us" || u === "µs" || u.includes("micro")) return 1e-6;
  if (u === "min" || u.includes("minute")) return 60;
  return 1; // s / sec / seconds / unknown
}

/** Parse a numeric cell, accepting both `1.23` and German `1,23`; else null. */
function parseNumber(cell: string): number | null {
  const trimmed = cell.trim();
  if (trimmed === "") return null;
  // Only convert a decimal comma when it's clearly the decimal separator
  // (no dot present); avoids mangling thousands-grouped values.
  const normalized = trimmed.includes(".") ? trimmed : trimmed.replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Slugify a label into a stable, unique-per-log series key. */
function slugify(label: string, used: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "channel";
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}-${n}`;
    n += 1;
  }
  used.add(key);
  return key;
}

function parseMeta(metaLines: string[]): Partial<LogMeta> {
  const map = new Map<string, string>();
  for (const line of metaLines) {
    const sep = line.search(/[:=,]/);
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (key && value) map.set(key, value);
  }
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = map.get(k);
      if (v) return v;
    }
    return null;
  };
  return {
    vin: pick("vin", "fahrgestellnummer"),
    vehicle: pick("vehicle", "car", "fahrzeug", "model", "modell"),
    mapVersion: pick("map", "map version", "tune", "kennfeld", "software map"),
    software: pick("software", "tool", "mgflasher", "firmware"),
    date: pick("date", "datum", "timestamp", "logged"),
  };
}

/**
 * Parse an MGflasher-style datalog CSV into a chart-ready {@link ParsedLog}.
 * Throws only when the input has no usable header at all; otherwise it degrades
 * gracefully (skipping corrupt rows) so a mostly-good log still opens.
 */
export function parseLog(input: string): ParsedLog {
  const { metaLines, bodyLines } = splitBlocks(input);

  const headerLineIndex = bodyLines.findIndex((l) => l.trim() !== "");
  if (headerLineIndex === -1) {
    throw new Error("Die Datei enthält keine Daten.");
  }
  const headerLine = bodyLines[headerLineIndex];
  const delimiter = detectDelimiter(headerLine);
  const headerCells = splitLine(headerLine, delimiter).map(splitHeaderUnit);
  if (headerCells.length < 2) {
    throw new Error("Kein gültiger CSV-Header erkannt (zu wenige Spalten).");
  }

  // Locate the time column (first header matching a known time name).
  const timeCol = headerCells.findIndex((c) => TIME_HEADER.test(c.label));

  // Normalize the time axis to SECONDS regardless of the logged unit (MGflasher
  // exports "Time [ms]"). This keeps durations correct and lets time-based logic
  // (e.g. the post-shift exclusion zone) reason in real seconds.
  const timeScale = timeCol >= 0 ? timeUnitScale(headerCells[timeCol].unit) : 1;

  const columnCount = headerCells.length;
  const dataLines = bodyLines.slice(headerLineIndex + 1);

  // One raw numeric column-buffer per header cell.
  const columns: (number | null)[][] = headerCells.map(() => []);
  const time: number[] = [];
  let rowCount = 0;
  let skippedRows = 0;

  for (const line of dataLines) {
    if (line.trim() === "") continue;
    const cells = splitLine(line, delimiter);
    // Wrong shape → corrupt row.
    if (cells.length !== columnCount) {
      skippedRows += 1;
      continue;
    }
    // A real time column with a non-numeric value means we can't place the row.
    let x: number;
    if (timeCol >= 0) {
      const parsed = parseNumber(cells[timeCol]);
      if (parsed === null) {
        skippedRows += 1;
        continue;
      }
      x = parsed * timeScale;
    } else {
      x = rowCount;
    }
    time.push(x);
    for (let c = 0; c < columnCount; c += 1) {
      columns[c].push(parseNumber(cells[c]));
    }
    rowCount += 1;
  }

  // Build series for every non-time column that carries at least one number.
  const usedKeys = new Set<string>();
  const series: LogSeries[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    if (c === timeCol) continue;
    const values = columns[c];
    let min: number | null = null;
    let max: number | null = null;
    let hasNumber = false;
    for (const v of values) {
      if (v === null) continue;
      hasNumber = true;
      if (min === null || v < min) min = v;
      if (max === null || v > max) max = v;
    }
    if (!hasNumber) continue;
    const { label, unit } = headerCells[c];
    const group = groupForLabel(label);
    series.push({
      key: slugify(label, usedKeys),
      label,
      unit,
      group: group.label,
      color: colorForLabel(label, group.id),
      values,
      min,
      max,
    });
  }

  const meta = buildMeta(parseMeta(metaLines), series, time, timeCol >= 0);

  return {
    time,
    timeUnit: timeCol >= 0 ? "s" : "#",
    series,
    meta,
    rowCount,
    skippedRows,
  };
}

/** Merge header metadata with values computed from the parsed channels. */
function buildMeta(
  header: Partial<LogMeta>,
  series: LogSeries[],
  time: number[],
  hasRealTime: boolean,
): LogMeta {
  const rpm = series.find((s) => RPM_HEADER.test(s.label));
  const boost = series.find((s) => BOOST_HEADER.test(s.label) && /actual|ist/i.test(s.label))
    ?? series.find((s) => BOOST_HEADER.test(s.label));
  const gear = series.find((s) => GEAR_HEADER.test(s.label));

  let gearRange: [number, number] | null = null;
  if (gear && gear.min !== null && gear.max !== null) {
    gearRange = [gear.min, gear.max];
  }

  let duration: number | null = null;
  if (hasRealTime && time.length >= 2) {
    const span = time[time.length - 1] - time[0];
    if (Number.isFinite(span) && span > 0) duration = span;
  }

  return {
    vin: header.vin ?? null,
    vehicle: header.vehicle ?? null,
    mapVersion: header.mapVersion ?? null,
    software: header.software ?? null,
    date: header.date ?? null,
    peakBoost: boost?.max ?? null,
    peakBoostUnit: boost?.unit ?? null,
    maxRpm: rpm?.max ?? null,
    gearRange,
    duration,
  };
}
