import { resolveChannels, type ResolvedChannels } from "./channels";
import { toLambda } from "./engineProfiles";
import { toBar, type AlertSeverity, type LogPullEvaluation } from "./evaluate-log-pull";
import {
  CORRECTION_LABELS,
  METHOD_LABELS,
  OUTPUT_LABELS,
  powerOf,
  type CorrectionStandard,
  type DynoEstimate,
  type DynoOutput,
} from "./dyno-engine";
import { summarizeSpec, type VehicleSpec } from "./vehicle-spec";
import type { LogSeries, ParsedLog } from "./types";

// The report model: everything a PDF or PNG export needs, extracted from an
// already-parsed log, its evaluation and (optionally) its dyno estimate into one
// flat, serializable payload.
//
// This module is pure and framework-free on purpose. The payload crosses two
// boundaries — it is built in the browser for the client-side PNG snippet, and
// rebuilt on the server for the react-pdf document — so it must contain only
// plain JSON data: no React, no DOM, no Recharts, and no `Date` objects.
//
// Nothing here re-derives analysis. Verdicts come from `evaluateLogPull`, power
// figures from `estimateDyno`; this module only selects, converts and formats.

/** Which artefact the export produces. */
export type ReportFormat = "pdf" | "png";

/** Export colour scheme. Light is the print-optimized default. */
export type ReportTheme = "light" | "dark";

/** The optional blocks the user can switch on/off in the export modal. */
export interface ReportSections {
  wotChart: boolean;
  violations: boolean;
  dynoCurve: boolean;
  fileSummary: boolean;
}

export const DEFAULT_REPORT_SECTIONS: ReportSections = {
  wotChart: true,
  violations: true,
  dynoCurve: true,
  fileSummary: true,
};

// ── Tuner platform ─────────────────────────────────────────────────────────

export type TunerPlatformId = "mgflasher" | "mhd" | "bootmod3" | "unknown";

export const TUNER_PLATFORM_LABELS: Record<TunerPlatformId, string> = {
  mgflasher: "MGflasher",
  mhd: "MHD",
  bootmod3: "bootmod3 (BM3)",
  unknown: "Unbekannt",
};

/**
 * Identify the tuning tool a log came from. The three platforms are recognised
 * from, in order of confidence: the import source URL, the `# Software:` /
 * `# Map:` metadata header, and finally the channel naming — each tool exports a
 * few characteristic column labels (bootmod3 prefixes with "bm3_", MHD writes
 * "AFR"/"Timing Correction Cyl", MGflasher uses "Fuel: …"-style group prefixes).
 */
export function detectTunerPlatform(log: ParsedLog, sourceUrl?: string | null): TunerPlatformId {
  const haystacks = [
    sourceUrl ?? "",
    log.meta.software ?? "",
    log.meta.mapVersion ?? "",
  ]
    .join(" ")
    .toLowerCase();
  if (/mgflasher|mg-flasher/.test(haystacks)) return "mgflasher";
  if (/bootmod|bm3\b/.test(haystacks)) return "bootmod3";
  if (/\bmhd\b/.test(haystacks)) return "mhd";

  const labels = log.series.map((s) => s.label.toLowerCase()).join(" | ");
  if (/\bbm3[_ ]/.test(labels)) return "bootmod3";
  if (/\bfuel:\s/.test(labels)) return "mgflasher";
  if (/\bafr\b/.test(labels)) return "mhd";
  return "unknown";
}

// ── Payload shape ──────────────────────────────────────────────────────────

/** A label/value pair rendered as a metric tile or a table row. */
export interface ReportMetric {
  label: string;
  value: string;
  hint?: string;
}

/** One plotted trace inside a chart panel. */
export interface ReportPanelSeries {
  key: string;
  label: string;
  /** Hex colour; the renderers use it verbatim in both themes. */
  color: string;
  /** Dashed traces mark the "target"/reference of a pair. */
  dashed: boolean;
  /** Which of the panel's two value scales this trace belongs to. */
  axis: "left" | "right";
  /** One value per `panel.x` entry; null marks a gap. */
  values: (number | null)[];
}

/** A time-stamped threshold breach drawn as a vertical marker. */
export interface ReportMarker {
  x: number;
  label: string;
  severity: AlertSeverity;
}

/** One stacked chart panel with its own value scale(s). */
export interface ReportChartPanel {
  id: string;
  title: string;
  /** Axis unit captions, e.g. "bar" / "°". Null when the values are unit-less. */
  leftUnit: string | null;
  rightUnit: string | null;
  xLabel: string;
  x: number[];
  series: ReportPanelSeries[];
  markers: ReportMarker[];
  /** Highlighted x-range (the detected WOT pull), when meaningful. */
  band: { start: number; end: number } | null;
}

export interface ReportViolationRow {
  severity: AlertSeverity;
  /** Formatted timestamp, e.g. "12,4 s" or "#310". */
  at: string;
  label: string;
  detail: string;
}

export interface ReportDynoSummary {
  method: string;
  correction: string;
  /** Applied atmospheric factor, or null when uncorrected. */
  correctionFactor: number | null;
  output: string;
  peakPs: number | null;
  peakKw: number | null;
  peakPowerRpm: number | null;
  peakNm: number | null;
  peakTorqueRpm: number | null;
  /** Where the underlying airflow / road speed came from. */
  source: string;
  ambient: string;
  notes: string[];
}

export interface ReportPayload {
  /** Log file name — the report's headline. */
  title: string;
  /** ISO timestamp the report was generated at. */
  generatedAt: string;
  meta: {
    vehicle: string | null;
    vin: string | null;
    loggedAt: string | null;
    mapVersion: string | null;
    software: string | null;
    platform: TunerPlatformId;
    platformLabel: string;
    /** SHA-256 (hex) of the raw CSV, when the log is server-persisted. */
    contentHash: string | null;
    source: string | null;
  };
  verdict: {
    status: LogPullEvaluation["validity"]["status"];
    statusLabel: string;
    health: "safe" | "caution" | "danger";
    healthLabel: string;
    /** Peak boost / max IAT / max timing pull + pull context. */
    metrics: ReportMetric[];
    /** German notes explaining anything less than ideal. */
    reasons: string[];
  };
  /** Vehicle/hardware profile the verdict was judged against. */
  specSummary: string;
  panels: ReportChartPanel[];
  violations: ReportViolationRow[];
  dyno: ReportDynoSummary | null;
  dynoPanel: ReportChartPanel | null;
  fileSummary: ReportMetric[];
  sections: ReportSections;
  theme: ReportTheme;
}

// ── Formatting helpers ─────────────────────────────────────────────────────

/**
 * German number formatting without `Intl`: the payload is rendered by react-pdf
 * on the server and by a hand-written SVG builder in the browser, and a plain
 * decimal-comma swap is both deterministic across those two and enough for the
 * short figures in a report.
 */
export function fmtNum(value: number, digits = 0): string {
  const fixed = value.toFixed(digits);
  const [whole, frac] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac ? `${grouped},${frac}` : grouped;
}

function fmtOrDash(value: number | null, digits: number, unit: string): string {
  return value === null ? "—" : `${fmtNum(value, digits)} ${unit}`;
}

/** Format an x-axis value as a report timestamp. */
export function fmtAxis(x: number, timeUnit: ParsedLog["timeUnit"]): string {
  return timeUnit === "s" ? `${fmtNum(x, 1)} s` : `#${fmtNum(x, 0)}`;
}

const STATUS_LABELS: Record<LogPullEvaluation["validity"]["status"], string> = {
  verified: "VERIFIED",
  partial: "WARNING",
  invalid: "UNVERIFIED",
};

const HEALTH_LABELS: Record<"safe" | "caution" | "danger", string> = {
  safe: "Hardware-sicher",
  caution: "Beobachten",
  danger: "Hardware-Risiko",
};

// ── Channel extraction ─────────────────────────────────────────────────────

/** Largest non-null value of a series within [lo, hi]. */
function maxIn(series: LogSeries | null, lo: number, hi: number): number | null {
  if (!series) return null;
  let best: number | null = null;
  for (let i = lo; i <= hi; i += 1) {
    const v = series.values[i];
    if (v === null) continue;
    if (best === null || v > best) best = v;
  }
  return best;
}

/** Smallest non-null value across several series within [lo, hi]. */
function minAcross(list: LogSeries[], lo: number, hi: number): number | null {
  let best: number | null = null;
  for (const s of list) {
    for (let i = lo; i <= hi; i += 1) {
      const v = s.values[i];
      if (v === null) continue;
      if (best === null || v < best) best = v;
    }
  }
  return best;
}

/** Peak boost within the window, normalised to bar. */
export function peakBoostBar(ch: ResolvedChannels, lo: number, hi: number): number | null {
  if (!ch.boostActual) return null;
  const raw = maxIn(ch.boostActual, lo, hi);
  return raw === null ? null : toBar(raw, ch.boostActual.unit);
}

/**
 * The worst (most negative) ignition correction across all cylinders inside the
 * window — the report's "Max Timing Pull". Returns null without correction
 * channels, and 0 when nothing was ever pulled.
 */
export function maxTimingPull(ch: ResolvedChannels, lo: number, hi: number): number | null {
  if (ch.timingCorrections.length === 0) return null;
  const worst = minAcross(ch.timingCorrections, lo, hi);
  return worst === null ? null : Math.min(0, worst);
}

// ── Chart panels ───────────────────────────────────────────────────────────

/** Point budget per panel — plenty for a vector chart, small enough for JSON. */
const PANEL_POINTS = 240;

/** Uniform-stride sample indices across [lo, hi], capped at `target` points. */
export function strideIndices(lo: number, hi: number, target = PANEL_POINTS): number[] {
  if (hi < lo) return [];
  const span = hi - lo + 1;
  const stride = span > target ? Math.ceil(span / target) : 1;
  const out: number[] = [];
  for (let i = lo; i <= hi; i += stride) out.push(i);
  if (out[out.length - 1] !== hi) out.push(hi);
  return out;
}

/** Report palette — fixed hex so PDF and PNG render identically. */
const COLORS = {
  rpm: "#f97316",
  boostActual: "#2563eb",
  boostTarget: "#94a3b8",
  timing: "#0d9488",
  correction: "#dc2626",
  lambda: "#7c3aed",
  power: "#f97316",
  torque: "#2563eb",
} as const;

function pick(
  indices: number[],
  series: LogSeries,
  convert?: (v: number) => number,
): (number | null)[] {
  return indices.map((i) => {
    const v = series.values[i];
    if (v === null) return null;
    return convert ? convert(v) : v;
  });
}

/**
 * Build the stacked WOT-pull panels: engine speed, boost (actual vs. target),
 * ignition timing plus per-cylinder corrections, and lambda. Panels whose
 * channels are absent are simply omitted, so a sparse log yields a shorter but
 * still valid report rather than empty axes.
 */
export function buildWotPanels(
  log: ParsedLog,
  evaluation: LogPullEvaluation,
  ch: ResolvedChannels,
): ReportChartPanel[] {
  const [lo, hi] = evaluation.window;
  if (hi <= lo) return [];
  const indices = strideIndices(lo, hi);
  const x = indices.map((i) => log.time[i]);
  const xLabel = log.timeUnit === "s" ? "Zeit (s)" : "Sample";
  const band = evaluation.pullRange;
  const markers: ReportMarker[] = evaluation.violations.map((v) => ({
    x: v.time,
    label: v.label,
    severity: v.severity,
  }));

  const panels: ReportChartPanel[] = [];
  const base = { x, xLabel, band, rightUnit: null as string | null };

  if (ch.rpm) {
    panels.push({
      ...base,
      id: "rpm",
      title: "Drehzahl",
      leftUnit: "1/min",
      markers,
      series: [
        {
          key: "rpm",
          label: "Drehzahl",
          color: COLORS.rpm,
          dashed: false,
          axis: "left",
          values: pick(indices, ch.rpm),
        },
      ],
    });
  }

  if (ch.boostActual || ch.boostTarget) {
    const series: ReportPanelSeries[] = [];
    // Both traces are converted to bar so target and actual share one scale even
    // when the log mixes units (psi actual + bar target happens in the wild).
    if (ch.boostActual) {
      const unit = ch.boostActual.unit;
      series.push({
        key: "boost-actual",
        label: "Ladedruck Ist",
        color: COLORS.boostActual,
        dashed: false,
        axis: "left",
        values: pick(indices, ch.boostActual, (v) => toBar(v, unit)),
      });
    }
    if (ch.boostTarget) {
      const unit = ch.boostTarget.unit;
      series.push({
        key: "boost-target",
        label: "Ladedruck Soll",
        color: COLORS.boostTarget,
        dashed: true,
        axis: "left",
        values: pick(indices, ch.boostTarget, (v) => toBar(v, unit)),
      });
    }
    panels.push({ ...base, id: "boost", title: "Ladedruck", leftUnit: "bar", markers, series });
  }

  if (ch.ignitionTiming || ch.timingCorrections.length > 0) {
    const series: ReportPanelSeries[] = [];
    if (ch.ignitionTiming) {
      series.push({
        key: "timing",
        label: "Zündwinkel",
        color: COLORS.timing,
        dashed: false,
        axis: "left",
        values: pick(indices, ch.ignitionTiming),
      });
    }
    for (const corr of ch.timingCorrections) {
      series.push({
        key: `corr-${corr.key}`,
        label: corr.label,
        color: COLORS.correction,
        dashed: true,
        // Corrections swing around 0° while absolute timing sits at 5–20°;
        // a separate right scale keeps small pulls visible.
        axis: ch.ignitionTiming ? "right" : "left",
        values: pick(indices, corr),
      });
    }
    panels.push({
      ...base,
      id: "timing",
      title: "Zündung & Korrekturen",
      leftUnit: "°",
      rightUnit: ch.ignitionTiming && ch.timingCorrections.length > 0 ? "° Korr." : null,
      markers,
      series,
    });
  }

  if (ch.lambda) {
    const unit = ch.lambda.unit;
    panels.push({
      ...base,
      id: "lambda",
      title: "Gemisch",
      leftUnit: "λ",
      markers,
      series: [
        {
          key: "lambda",
          label: "Lambda",
          color: COLORS.lambda,
          dashed: false,
          axis: "left",
          // Normalised so an AFR-scaled channel (MHD) plots on the same λ scale.
          values: pick(indices, ch.lambda, (v) => toLambda(v, unit)),
        },
      ],
    });
  }

  return panels;
}

/** Build the power/torque panel from a dyno estimate (dual-axis: PS and Nm). */
export function buildDynoPanel(
  estimate: DynoEstimate,
  output: DynoOutput,
): ReportChartPanel | null {
  const curve = estimate.primary;
  if (!curve || curve.points.length === 0) return null;
  const x = curve.points.map((p) => p.rpm);
  const values = curve.points.map((p) => powerOf(p, output));
  return {
    id: "dyno",
    title: `Leistung & Drehmoment · ${OUTPUT_LABELS[output]}`,
    leftUnit: "PS",
    rightUnit: "Nm",
    xLabel: "Drehzahl (1/min)",
    x,
    band: null,
    markers: [],
    series: [
      {
        key: "power",
        label: "Leistung",
        color: COLORS.power,
        dashed: false,
        axis: "left",
        values: values.map((v) => v.ps),
      },
      {
        key: "torque",
        label: "Drehmoment",
        color: COLORS.torque,
        dashed: true,
        axis: "right",
        values: values.map((v) => v.nm),
      },
    ],
  };
}

/** Condense a dyno estimate into the report's summary block. */
export function buildDynoSummary(
  estimate: DynoEstimate,
  output: DynoOutput,
  correction: CorrectionStandard,
): ReportDynoSummary | null {
  const curve = estimate.primary;
  if (!curve) return null;
  const power = curve.peakPower ? powerOf(curve.peakPower, output) : null;
  const torque = curve.peakTorque ? powerOf(curve.peakTorque, output) : null;
  return {
    method: METHOD_LABELS[curve.method],
    correction: CORRECTION_LABELS[correction],
    correctionFactor: correction === "none" ? null : curve.correctionFactor,
    output: OUTPUT_LABELS[output],
    peakPs: power ? power.ps : null,
    peakKw: power ? power.kw : null,
    peakPowerRpm: curve.peakPower ? curve.peakPower.rpm : null,
    peakNm: torque ? torque.nm : null,
    peakTorqueRpm: curve.peakTorque ? curve.peakTorque.rpm : null,
    source: curve.source,
    ambient: `${fmtNum(curve.ambient.pressureHpa)} hPa · ${fmtNum(curve.ambient.tempC, 1)} °C${
      curve.ambient.pressureFromLog ? " (aus dem Log)" : " (Normbedingungen)"
    }`,
    notes: estimate.notes,
  };
}

// ── Entry point ────────────────────────────────────────────────────────────

export interface ReportInput {
  /** Log file name — becomes the report title. */
  name: string;
  log: ParsedLog;
  evaluation: LogPullEvaluation;
  spec: VehicleSpec;
  /** Hardware health derived from the alerts. */
  health: "safe" | "caution" | "danger";
  /** Present only when the dyno section is requested and estimable. */
  dyno?: {
    estimate: DynoEstimate;
    output: DynoOutput;
    correction: CorrectionStandard;
  } | null;
  contentHash?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  sections?: Partial<ReportSections>;
  theme?: ReportTheme;
  /** ISO timestamp; injected so tests and both renderers stay deterministic. */
  generatedAt: string;
}

/**
 * Assemble the full export payload. Total and defensive: a log without charts,
 * violations or a dyno estimate yields a shorter report rather than throwing, so
 * every section is independently optional.
 */
export function buildReportPayload(input: ReportInput): ReportPayload {
  const sections: ReportSections = { ...DEFAULT_REPORT_SECTIONS, ...input.sections };
  const { log, evaluation, spec } = input;
  const ch = resolveChannels(log);
  const [lo, hi] = evaluation.window;

  const boost = peakBoostBar(ch, lo, hi);
  const iat = maxIn(ch.iat, lo, hi);
  const pull = maxTimingPull(ch, lo, hi);
  const egt = maxIn(ch.egt, lo, hi);

  const metrics: ReportMetric[] = [
    {
      label: "Peak Boost",
      value: fmtOrDash(boost, 2, "bar"),
      hint: `Grenze ${fmtNum(evaluation.limits.maxBoost, 2)} bar`,
    },
    {
      label: "Max. IAT",
      value: fmtOrDash(iat, 0, "°C"),
      hint: `Warnung ab ${evaluation.limits.iatWarn} °C`,
    },
    {
      label: "Max. Timing Pull",
      value: pull === null ? "—" : `${fmtNum(pull, 1)} °`,
      hint: `Grenze ${fmtNum(evaluation.limits.knockCorrection, 1)} °`,
    },
    {
      label: "Max. EGT",
      value: fmtOrDash(egt, 0, "°C"),
      hint: `Grenze ${evaluation.limits.maxEgt} °C`,
    },
  ];

  const fileSummary: ReportMetric[] = [
    { label: "Datenzeilen", value: fmtNum(log.rowCount) },
    { label: "Verworfene Zeilen", value: fmtNum(log.skippedRows) },
    { label: "Kanäle", value: fmtNum(log.series.length) },
    {
      label: "Dauer",
      value: log.meta.duration === null ? "—" : `${fmtNum(log.meta.duration, 1)} s`,
    },
    {
      label: "Pull-Fenster",
      value:
        evaluation.pullRange === null
          ? "—"
          : `${fmtAxis(evaluation.pullRange.start, log.timeUnit)} – ${fmtAxis(
              evaluation.pullRange.end,
              log.timeUnit,
            )}`,
    },
    {
      label: "Max. Drehzahl",
      value: fmtOrDash(log.meta.maxRpm, 0, "1/min"),
    },
    {
      label: "Gang",
      value: evaluation.validity.gears.length > 0 ? evaluation.validity.gears.join("→") : "—",
    },
    {
      label: "Volllast-Anteil",
      value:
        evaluation.validity.wotCoverage === null
          ? "—"
          : `${fmtNum(evaluation.validity.wotCoverage * 100, 0)} %`,
    },
  ];

  const violations: ReportViolationRow[] = evaluation.violations.map((v) => ({
    severity: v.severity,
    at: fmtAxis(v.time, log.timeUnit),
    label: v.label,
    detail: v.detail,
  }));

  const platform = detectTunerPlatform(log, input.sourceUrl);
  const dynoInput = input.dyno ?? null;

  return {
    title: input.name,
    generatedAt: input.generatedAt,
    meta: {
      vehicle: log.meta.vehicle,
      vin: log.meta.vin,
      loggedAt: log.meta.date,
      mapVersion: log.meta.mapVersion,
      software: log.meta.software,
      platform,
      platformLabel: TUNER_PLATFORM_LABELS[platform],
      contentHash: input.contentHash ?? null,
      source: input.source ?? null,
    },
    verdict: {
      status: evaluation.validity.status,
      statusLabel: STATUS_LABELS[evaluation.validity.status],
      health: input.health,
      healthLabel: HEALTH_LABELS[input.health],
      metrics,
      reasons: evaluation.validity.reasons,
    },
    specSummary: summarizeSpec(spec),
    panels: sections.wotChart ? buildWotPanels(log, evaluation, ch) : [],
    violations: sections.violations ? violations : [],
    dyno:
      sections.dynoCurve && dynoInput
        ? buildDynoSummary(dynoInput.estimate, dynoInput.output, dynoInput.correction)
        : null,
    dynoPanel:
      sections.dynoCurve && dynoInput ? buildDynoPanel(dynoInput.estimate, dynoInput.output) : null,
    fileSummary: sections.fileSummary ? fileSummary : [],
    sections,
    theme: input.theme ?? "light",
  };
}

/**
 * Download filename for a report: the log name, stripped of its extension and
 * slugified, plus the generation date and the format's extension.
 */
export function reportFilename(payload: ReportPayload, format: ReportFormat): string {
  const base =
    payload.title
      .replace(/\.[a-z0-9]+$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "log";
  const date = payload.generatedAt.slice(0, 10);
  return `zaehlwerk-logbericht_${base}_${date}.${format}`;
}
