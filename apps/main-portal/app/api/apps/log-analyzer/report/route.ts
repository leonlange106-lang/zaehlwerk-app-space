import React from "react";
import { type NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getLog } from "@/app/lib/log-repository";
import { sha256Hex } from "@/app/lib/crypto";
import { parseLog } from "@/app/apps/log-analyzer/lib/log-parser";
import { evaluateLogPull, healthFromAlerts } from "@/app/apps/log-analyzer/lib/evaluate-log-pull";
import { DEFAULT_VEHICLE_SPEC, type VehicleSpec } from "@/app/apps/log-analyzer/lib/vehicle-spec";
import { DEFAULT_DYNO_PROFILE, type DynoProfile } from "@/app/apps/log-analyzer/lib/dyno-spec";
import {
  estimateDyno,
  type CorrectionStandard,
  type DynoOutput,
} from "@/app/apps/log-analyzer/lib/dyno-engine";
import {
  buildReportPayload,
  DEFAULT_REPORT_SECTIONS,
  reportFilename,
  type ReportPayload,
  type ReportSections,
  type ReportTheme,
} from "@/app/apps/log-analyzer/lib/report-generator";
import { LogAnalyzerReport } from "@/src/components/pdf/LogAnalyzerReport";

// Report generation for the Log Analyzer.
//
// The payload is ALWAYS assembled here, never on the client, for two reasons:
// the SHA-256 file hash in the header has to be computed over the stored CSV
// (`node:crypto`, not available over plain HTTP in the browser), and building it
// once server-side is what guarantees the PDF and the PNG describe exactly the
// same run. Consequently:
//
//   format: "pdf" → the rendered A4 document (application/pdf)
//   format: "png" → the payload as JSON, which the browser rasterizes from the
//                   shared SVG builder; a canvas only exists client-side.
//
// The vehicle spec and dyno profile live in the caller's localStorage, so they
// come in with the request and are merged defensively over the defaults — a
// hand-edited or stale profile yields a report with default limits, never a 500.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generous cap for an ad-hoc CSV posted straight from the dyno page. */
const MAX_CSV_BYTES = 8_000_000;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Take `key` from `raw` when it is a finite number, else the default. */
function num(raw: Record<string, unknown>, key: string, fallback: number): number {
  const v = raw[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Merge a client-supplied vehicle spec over the defaults.
 *
 * The five hardware enums are validated against their allowed values rather
 * than merely type-checked: `limitsForSpec` indexes lookup tables with them, so
 * an unrecognised string would silently produce NaN thresholds and a report full
 * of nonsense limits. Free-text catalogue ids stay as they are (display only),
 * and an unknown engine code falls back inside `engineProfile`.
 */
function sanitizeSpec(raw: unknown): VehicleSpec {
  const input = asRecord(raw);
  const str = (key: keyof VehicleSpec): string | null => {
    const v = input[key];
    return typeof v === "string" && v !== "" ? v : null;
  };
  return {
    brand: str("brand") ?? DEFAULT_VEHICLE_SPEC.brand,
    series: str("series") ?? DEFAULT_VEHICLE_SPEC.series,
    model: str("model") ?? DEFAULT_VEHICLE_SPEC.model,
    engineCode: (str("engineCode") ?? DEFAULT_VEHICLE_SPEC.engineCode) as VehicleSpec["engineCode"],
    transmission: (str("transmission") ??
      DEFAULT_VEHICLE_SPEC.transmission) as VehicleSpec["transmission"],
    catType: oneOf(input.catType, ["oem", "cat200", "catless"] as const, DEFAULT_VEHICLE_SPEC.catType),
    fuel: oneOf(
      input.fuel,
      ["ron95", "ron98", "ron102", "e30", "e85"] as const,
      DEFAULT_VEHICLE_SPEC.fuel,
    ),
    turbo: oneOf(input.turbo, ["stock", "upgraded"] as const, DEFAULT_VEHICLE_SPEC.turbo),
    hpfp: oneOf(input.hpfp, ["oem", "upgraded"] as const, DEFAULT_VEHICLE_SPEC.hpfp),
    stage: oneOf(
      input.stage,
      ["oem", "stage1", "stage2", "custom"] as const,
      DEFAULT_VEHICLE_SPEC.stage,
    ),
  };
}

/** Merge a client-supplied dyno profile over the defaults, field by field. */
function sanitizeProfile(raw: unknown): DynoProfile {
  const input = asRecord(raw);
  const tire = asRecord(input.tire);
  const ratios = Array.isArray(input.gearRatios)
    ? input.gearRatios.filter((r): r is number => typeof r === "number" && Number.isFinite(r) && r > 0)
    : [];
  const gear = input.gear;
  return {
    presetId: typeof input.presetId === "string" ? input.presetId : null,
    massKg: num(input, "massKg", DEFAULT_DYNO_PROFILE.massKg),
    drivetrainLossPct: num(input, "drivetrainLossPct", DEFAULT_DYNO_PROFILE.drivetrainLossPct),
    displacementL: num(input, "displacementL", DEFAULT_DYNO_PROFILE.displacementL),
    volumetricEfficiency: num(input, "volumetricEfficiency", DEFAULT_DYNO_PROFILE.volumetricEfficiency),
    gramsPerHp: num(input, "gramsPerHp", DEFAULT_DYNO_PROFILE.gramsPerHp),
    tire: {
      widthMm: num(tire, "widthMm", DEFAULT_DYNO_PROFILE.tire.widthMm),
      aspectPct: num(tire, "aspectPct", DEFAULT_DYNO_PROFILE.tire.aspectPct),
      rimIn: num(tire, "rimIn", DEFAULT_DYNO_PROFILE.tire.rimIn),
    },
    gearRatios: ratios.length > 0 ? ratios : DEFAULT_DYNO_PROFILE.gearRatios,
    finalDrive: num(input, "finalDrive", DEFAULT_DYNO_PROFILE.finalDrive),
    gear: typeof gear === "number" && Number.isFinite(gear) ? gear : null,
    dragCoefficient: num(input, "dragCoefficient", DEFAULT_DYNO_PROFILE.dragCoefficient),
    frontalAreaM2: num(input, "frontalAreaM2", DEFAULT_DYNO_PROFILE.frontalAreaM2),
    rollingResistance: num(input, "rollingResistance", DEFAULT_DYNO_PROFILE.rollingResistance),
    rotatingMassFactor: num(input, "rotatingMassFactor", DEFAULT_DYNO_PROFILE.rotatingMassFactor),
  };
}

function sanitizeSections(raw: unknown): ReportSections {
  const input = asRecord(raw);
  const out = { ...DEFAULT_REPORT_SECTIONS };
  for (const key of Object.keys(DEFAULT_REPORT_SECTIONS) as (keyof ReportSections)[]) {
    if (typeof input[key] === "boolean") out[key] = input[key] as boolean;
  }
  return out;
}

interface ResolvedSource {
  name: string;
  csv: string;
  source: string | null;
  sourceUrl: string | null;
}

/** Load the log either from the store (by id) or from an inlined CSV. */
async function resolveSource(body: Record<string, unknown>): Promise<ResolvedSource | NextResponse> {
  const logId = body.logId;
  if (typeof logId === "string" && logId !== "") {
    const record = await getLog(logId);
    if (!record) return NextResponse.json({ error: "Log nicht gefunden." }, { status: 404 });
    return {
      name: record.name,
      csv: record.csv,
      source: record.source,
      sourceUrl: record.sourceUrl,
    };
  }

  const csv = body.csv;
  const name = body.name;
  if (typeof csv !== "string" || csv === "") {
    return NextResponse.json({ error: "Weder logId noch csv übermittelt." }, { status: 400 });
  }
  if (csv.length > MAX_CSV_BYTES) {
    return NextResponse.json({ error: "Log ist zu groß für einen Bericht." }, { status: 413 });
  }
  return {
    name: typeof name === "string" && name !== "" ? name : "Log",
    csv,
    source: null,
    sourceUrl: null,
  };
}

export async function POST(request: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger Request-Body." }, { status: 400 });
  }
  const body = asRecord(parsed);

  const format = oneOf(body.format, ["pdf", "png"] as const, "pdf");
  const theme = oneOf(body.theme, ["light", "dark"] as const, "light") as ReportTheme;
  const sections = sanitizeSections(body.sections);

  const resolved = await resolveSource(body);
  if (resolved instanceof NextResponse) return resolved;

  let payload: ReportPayload;
  try {
    const log = parseLog(resolved.csv);
    if (log.rowCount === 0) {
      return NextResponse.json(
        { error: "Das Log enthält keine auswertbaren Datenzeilen." },
        { status: 422 },
      );
    }

    const spec = sanitizeSpec(body.spec);
    const evaluation = evaluateLogPull(log, spec);

    // The dyno section is only computed when it is actually going to be shown —
    // it is the most expensive part of the report by a wide margin.
    let dyno: Parameters<typeof buildReportPayload>[0]["dyno"] = null;
    if (sections.dynoCurve && body.dyno) {
      const dynoInput = asRecord(body.dyno);
      const correction = oneOf(dynoInput.correction, ["none", "sae", "din"] as const, "none");
      const output = oneOf(dynoInput.output, ["crank", "wheel"] as const, "crank");
      dyno = {
        estimate: estimateDyno(log, sanitizeProfile(dynoInput.profile), { correction }),
        output: output as DynoOutput,
        correction: correction as CorrectionStandard,
      };
    }

    payload = buildReportPayload({
      name: resolved.name,
      log,
      evaluation,
      spec,
      health: healthFromAlerts(evaluation.alerts),
      dyno,
      // Computed over the stored CSV, so it matches LogFile.contentHash exactly.
      contentHash: sha256Hex(resolved.csv),
      source: resolved.source,
      sourceUrl: resolved.sourceUrl,
      sections,
      theme,
      generatedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "Das Log konnte nicht ausgewertet werden." }, { status: 422 });
  }

  if (format === "png") {
    // The browser owns rasterization; hand back the data it needs to draw.
    return NextResponse.json({ payload }, { headers: { "Cache-Control": "no-store" } });
  }

  // renderToBuffer is typed for a <Document> element; LogAnalyzerReport returns
  // exactly that, but its own props type is {payload}, so bridge the two.
  const element = React.createElement(LogAnalyzerReport, { payload }) as unknown as Parameters<
    typeof renderToBuffer
  >[0];
  const buffer = await renderToBuffer(element);

  // The filename is derived from the payload the server just built, so the
  // client never has to reconstruct the log's title or the generation date.
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportFilename(payload, "pdf")}"`,
      "Cache-Control": "no-store",
    },
  });
}
