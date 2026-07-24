import { describe, expect, it } from "vitest";
import { evaluateLogPull, healthFromAlerts } from "./evaluate-log-pull";
import { DEFAULT_VEHICLE_SPEC } from "./vehicle-spec";
import { makeLog, verifiedPullColumns, type ColumnSpec } from "./test-helpers";
import { buildReportPayload, type ReportPayload, type ReportTheme } from "./report-generator";
import { buildReportSvg, escapeXml, PALETTES, snippetHeight, statusColor } from "./report-svg";

function payloadFor(theme: ReportTheme = "light", extra: ColumnSpec[] = []): ReportPayload {
  const columns = verifiedPullColumns();
  const n = columns[0].values.length;
  const time = Array.from({ length: n }, (_, i) => i * 0.1);
  const log = makeLog(
    [...columns, { label: "IAT", unit: "°C", values: new Array(n).fill(40) }, ...extra],
    time,
  );
  const evaluation = evaluateLogPull(log, DEFAULT_VEHICLE_SPEC);
  return buildReportPayload({
    name: "pull.csv",
    log,
    evaluation,
    spec: DEFAULT_VEHICLE_SPEC,
    health: healthFromAlerts(evaluation.alerts),
    generatedAt: "2026-07-24T10:30:00.000Z",
    theme,
  });
}

describe("escapeXml", () => {
  it("escapes every XML-significant character", () => {
    expect(escapeXml(`<a href="x">R&D 'ok'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;R&amp;D &apos;ok&apos;&lt;/a&gt;",
    );
  });
});

describe("buildReportSvg", () => {
  it("produces a well-formed, self-contained SVG document", () => {
    const svg = buildReportSvg(payloadFor());
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    // Canvas rasterization breaks on any external reference. The SVG namespace
    // is a declaration, not a fetch, so it is the one allowed URI.
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:\/\//);
    expect(svg).not.toContain("<style");
    expect(svg).not.toContain("@import");
    expect(svg).not.toContain("<image");
  });

  it("scales the raster size while keeping the coordinate system", () => {
    const payload = payloadFor();
    const height = snippetHeight(payload);
    const svg = buildReportSvg(payload, 3);
    expect(svg).toContain(`viewBox="0 0 900 ${height}"`);
    expect(svg).toContain(`width="2700"`);
    expect(svg).toContain(`height="${Math.round(height * 3)}"`);
  });

  it("renders the title, verdict badge and key metrics", () => {
    const svg = buildReportSvg(payloadFor());
    expect(svg).toContain("pull.csv");
    expect(svg).toContain("VERIFIED");
    expect(svg).toContain("PEAK BOOST");
    expect(svg).toContain("MAX. TIMING PULL");
  });

  it("draws a polyline for every panel trace", () => {
    const payload = payloadFor();
    const svg = buildReportSvg(payload);
    expect(payload.panels.length).toBeGreaterThan(0);
    expect(svg.match(/<polyline /g)?.length ?? 0).toBeGreaterThanOrEqual(payload.panels.length);
  });

  it("escapes channel labels coming from the log", () => {
    const n = verifiedPullColumns()[0].values.length;
    const svg = buildReportSvg(
      payloadFor("light", [{ label: "Boost <script>", unit: "psi", values: new Array(n).fill(1) }]),
    );
    expect(svg).not.toContain("<script>");
  });

  it("switches the whole palette with the theme", () => {
    const light = buildReportSvg(payloadFor("light"));
    const dark = buildReportSvg(payloadFor("dark"));
    // The page background rect is the theme's tell; badge text stays white in both.
    expect(light).toContain(`height="${snippetHeight(payloadFor("light"))}" fill="${PALETTES.light.background}"`);
    expect(dark).toContain(`height="${snippetHeight(payloadFor("dark"))}" fill="${PALETTES.dark.background}"`);
    expect(light).toContain(PALETTES.light.text);
    expect(dark).toContain(PALETTES.dark.text);
    expect(dark).not.toContain(PALETTES.light.surface);
  });

  it("grows the canvas when a violations table is included", () => {
    const clean = payloadFor();
    const withViolations: ReportPayload = {
      ...clean,
      violations: [
        { severity: "critical", at: "1,2 s", label: "Klopfen", detail: "-7,0°" },
        { severity: "warning", at: "2,0 s", label: "IAT hoch", detail: "62 °C" },
      ],
    };
    expect(snippetHeight(withViolations)).toBeGreaterThan(snippetHeight(clean));
    expect(buildReportSvg(withViolations)).toContain("Sicherheits-Auffälligkeiten");
  });
});

describe("statusColor", () => {
  it("maps each verdict onto its palette colour", () => {
    const payload = payloadFor();
    const palette = PALETTES.light;
    expect(statusColor(payload, palette)).toBe(palette.ok);
    expect(statusColor({ ...payload, verdict: { ...payload.verdict, status: "partial" } }, palette)).toBe(
      palette.warning,
    );
    expect(statusColor({ ...payload, verdict: { ...payload.verdict, status: "invalid" } }, palette)).toBe(
      palette.critical,
    );
  });
});
