import { buildPanelGeometry, pointsAttr, type PanelGeometry } from "./report-chart";
import type { ReportChartPanel, ReportPayload, ReportTheme } from "./report-generator";

// Builds the PNG export's source image as a self-contained SVG string.
//
// "Self-contained" is a hard requirement, not a nicety: the browser rasterizes
// this by loading it into an <img> and drawing it to a canvas, and any external
// reference (a webfont, a stylesheet, an image) would either fail to load or
// taint the canvas and make `toBlob` throw. So: system font stack only, every
// colour inline, no <style> element, no external URLs.
//
// Pure string building — no DOM. The rasterization step lives in report-png.ts.

export interface ReportPalette {
  background: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  grid: string;
  accent: string;
  warning: string;
  critical: string;
  ok: string;
}

export const PALETTES: Record<ReportTheme, ReportPalette> = {
  light: {
    background: "#ffffff",
    surface: "#f8fafc",
    border: "#e2e8f0",
    text: "#0f172a",
    muted: "#64748b",
    grid: "#e2e8f0",
    accent: "#f97316",
    warning: "#d97706",
    critical: "#dc2626",
    ok: "#15803d",
  },
  dark: {
    background: "#0f172a",
    surface: "#1e293b",
    border: "#334155",
    text: "#f1f5f9",
    muted: "#94a3b8",
    grid: "#334155",
    accent: "#fb923c",
    warning: "#fbbf24",
    critical: "#f87171",
    ok: "#4ade80",
  },
};

/** Colour of the status badge for a pull verdict. */
export function statusColor(payload: ReportPayload, palette: ReportPalette): string {
  if (payload.verdict.status === "verified") return palette.ok;
  if (payload.verdict.status === "partial") return palette.warning;
  return palette.critical;
}

const FONT = "Helvetica, Arial, 'Segoe UI', sans-serif";

/** Escape the five XML-significant characters — log labels are user data. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface TextOptions {
  size?: number;
  color?: string;
  weight?: 400 | 600 | 700;
  anchor?: "start" | "middle" | "end";
}

function text(x: number, y: number, content: string, options: TextOptions = {}): string {
  const { size = 11, color = "#000000", weight = 400, anchor = "start" } = options;
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${escapeXml(
    content,
  )}</text>`;
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  opts: { stroke?: string; radius?: number; opacity?: number } = {},
): string {
  const { stroke, radius = 0, opacity } = opts;
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `width="${Math.max(0, w)}"`,
    `height="${Math.max(0, h)}"`,
    `fill="${fill}"`,
    radius ? `rx="${radius}"` : "",
    stroke ? `stroke="${stroke}" stroke-width="1"` : "",
    opacity !== undefined ? `opacity="${opacity}"` : "",
  ].filter(Boolean);
  return `<rect ${attrs.join(" ")} />`;
}

// ── Layout constants ───────────────────────────────────────────────────────

const WIDTH = 900;
const PAD = 24;
const HEADER_H = 78;
const METRICS_H = 62;
const PANEL_H = 132;
const PANEL_GAP = 10;
const PANEL_TITLE_H = 16;
const VIOLATION_ROW_H = 15;
const FOOTER_H = 26;

/** Panels the PNG snippet renders, in order: WOT panels then the dyno curve. */
export function snippetPanels(payload: ReportPayload): ReportChartPanel[] {
  const panels = [...payload.panels];
  if (payload.dynoPanel) panels.push(payload.dynoPanel);
  return panels;
}

/** Total pixel height of the snippet for a given payload (before scaling). */
export function snippetHeight(payload: ReportPayload): number {
  const panels = snippetPanels(payload);
  const violationRows = payload.violations.length;
  const violationsBlock =
    violationRows > 0 ? PANEL_TITLE_H + 8 + violationRows * VIOLATION_ROW_H + PANEL_GAP : 0;
  return (
    HEADER_H +
    METRICS_H +
    panels.length * (PANEL_TITLE_H + PANEL_H + PANEL_GAP) +
    violationsBlock +
    FOOTER_H
  );
}

function renderPanel(
  panel: ReportChartPanel,
  geometry: PanelGeometry,
  offsetY: number,
  palette: ReportPalette,
): string {
  const parts: string[] = [`<g transform="translate(0 ${offsetY})">`];

  // Plot frame + pull band behind everything else.
  parts.push(
    rect(geometry.plot.x, geometry.plot.y, geometry.plot.width, geometry.plot.height, palette.surface, {
      stroke: palette.border,
    }),
  );
  if (geometry.band) {
    parts.push(
      rect(geometry.band.x, geometry.plot.y, geometry.band.width, geometry.plot.height, palette.accent, {
        opacity: 0.1,
      }),
    );
  }

  // Horizontal gridlines + left/right value ticks.
  for (const tick of geometry.leftTicks) {
    parts.push(
      `<line x1="${geometry.plot.x}" y1="${tick.pos.toFixed(2)}" x2="${
        geometry.plot.x + geometry.plot.width
      }" y2="${tick.pos.toFixed(2)}" stroke="${palette.grid}" stroke-width="0.5" />`,
    );
    parts.push(
      text(geometry.plot.x - 5, tick.pos + 3, tick.label, {
        size: 8,
        color: palette.muted,
        anchor: "end",
      }),
    );
  }
  for (const tick of geometry.rightTicks) {
    parts.push(
      text(geometry.plot.x + geometry.plot.width + 5, tick.pos + 3, tick.label, {
        size: 8,
        color: palette.muted,
      }),
    );
  }
  for (const tick of geometry.xTicks) {
    parts.push(
      text(tick.pos, geometry.plot.y + geometry.plot.height + 12, tick.label, {
        size: 8,
        color: palette.muted,
        anchor: "middle",
      }),
    );
  }

  // Violation markers sit under the traces so they never hide the data.
  for (const marker of geometry.markers) {
    const color = marker.severity === "critical" ? palette.critical : palette.warning;
    parts.push(
      `<line x1="${marker.x.toFixed(2)}" y1="${geometry.plot.y}" x2="${marker.x.toFixed(2)}" y2="${
        geometry.plot.y + geometry.plot.height
      }" stroke="${color}" stroke-width="1" stroke-dasharray="3 2" opacity="0.75" />`,
    );
  }

  for (const line of geometry.lines) {
    for (const segment of line.segments) {
      if (segment.length === 1) {
        parts.push(
          `<circle cx="${segment[0].x.toFixed(2)}" cy="${segment[0].y.toFixed(2)}" r="1.5" fill="${line.color}" />`,
        );
        continue;
      }
      parts.push(
        `<polyline points="${pointsAttr(segment)}" fill="none" stroke="${line.color}" stroke-width="1.4"${
          line.dashed ? ' stroke-dasharray="4 3"' : ""
        } stroke-linejoin="round" stroke-linecap="round" />`,
      );
    }
  }

  // Axis unit captions.
  if (panel.leftUnit) {
    parts.push(text(geometry.plot.x - 5, geometry.plot.y - 4, panel.leftUnit, {
      size: 8,
      color: palette.muted,
      anchor: "end",
    }));
  }
  if (panel.rightUnit) {
    parts.push(
      text(geometry.plot.x + geometry.plot.width + 5, geometry.plot.y - 4, panel.rightUnit, {
        size: 8,
        color: palette.muted,
      }),
    );
  }

  parts.push("</g>");
  return parts.join("");
}

/** Inline legend swatches for one panel, laid out left-to-right from `x`. */
function renderLegend(panel: ReportChartPanel, x: number, y: number, palette: ReportPalette): string {
  const parts: string[] = [];
  let cursor = x;
  for (const series of panel.series) {
    parts.push(
      `<line x1="${cursor}" y1="${y - 3}" x2="${cursor + 12}" y2="${y - 3}" stroke="${series.color}" stroke-width="2"${
        series.dashed ? ' stroke-dasharray="3 2"' : ""
      } />`,
    );
    parts.push(text(cursor + 16, y, series.label, { size: 8, color: palette.muted }));
    // Advance by the swatch plus a rough text width; the legend is decorative,
    // so an approximate advance is fine and avoids needing font metrics.
    cursor += 16 + series.label.length * 4.4 + 14;
  }
  return parts.join("");
}

/**
 * Render the full report snippet as an SVG document string: header, verdict and
 * key metrics, every chart panel with its legend, and (when included) the safety
 * violation table. `scale` multiplies the raster size for a high-DPI PNG while
 * keeping the coordinate system — so text stays crisp instead of upscaled.
 */
export function buildReportSvg(payload: ReportPayload, scale = 2): string {
  const palette = PALETTES[payload.theme];
  const height = snippetHeight(payload);
  const contentWidth = WIDTH - PAD * 2;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(WIDTH * scale)}" height="${Math.round(
      height * scale,
    )}" viewBox="0 0 ${WIDTH} ${height}">`,
  );
  parts.push(rect(0, 0, WIDTH, height, palette.background));

  // ── Header ──
  parts.push(text(PAD, PAD + 6, payload.title, { size: 17, weight: 700, color: palette.text }));
  const metaLine = [
    payload.meta.vehicle,
    // An unidentified tuning tool adds nothing — leave it out rather than
    // captioning the report "Unbekannt".
    payload.meta.platform === "unknown" ? null : payload.meta.platformLabel,
    payload.meta.mapVersion,
    payload.meta.loggedAt,
  ]
    .filter(Boolean)
    .join("  ·  ");
  parts.push(text(PAD, PAD + 24, metaLine || "Keine Fahrzeug-Metadaten im Log", {
    size: 9.5,
    color: palette.muted,
  }));
  if (payload.meta.contentHash) {
    parts.push(
      text(PAD, PAD + 38, `SHA-256 ${payload.meta.contentHash.slice(0, 32)}…`, {
        size: 8,
        color: palette.muted,
      }),
    );
  }

  // Status badge, right-aligned in the header.
  const badgeColor = statusColor(payload, palette);
  const badgeW = Math.max(96, payload.verdict.statusLabel.length * 8 + 24);
  parts.push(rect(WIDTH - PAD - badgeW, PAD - 6, badgeW, 24, badgeColor, { radius: 4 }));
  parts.push(
    text(WIDTH - PAD - badgeW / 2, PAD + 10, payload.verdict.statusLabel, {
      size: 11,
      weight: 700,
      color: "#ffffff",
      anchor: "middle",
    }),
  );
  parts.push(
    text(WIDTH - PAD, PAD + 32, payload.verdict.healthLabel, {
      size: 9,
      color: palette.muted,
      anchor: "end",
    }),
  );
  parts.push(
    `<line x1="${PAD}" y1="${HEADER_H - 10}" x2="${WIDTH - PAD}" y2="${HEADER_H - 10}" stroke="${
      palette.border
    }" stroke-width="1" />`,
  );

  // ── Key metrics ──
  const metrics = payload.verdict.metrics;
  const tileW = metrics.length > 0 ? contentWidth / metrics.length : contentWidth;
  metrics.forEach((metric, index) => {
    const x = PAD + index * tileW;
    parts.push(text(x, HEADER_H + 10, metric.label.toUpperCase(), { size: 8, color: palette.muted, weight: 600 }));
    parts.push(text(x, HEADER_H + 30, metric.value, { size: 15, weight: 700, color: palette.text }));
    if (metric.hint) {
      parts.push(text(x, HEADER_H + 43, metric.hint, { size: 8, color: palette.muted }));
    }
  });

  // ── Chart panels ──
  let cursorY = HEADER_H + METRICS_H;
  for (const panel of snippetPanels(payload)) {
    const geometry = buildPanelGeometry(panel, WIDTH, PANEL_H);
    if (!geometry) continue;
    parts.push(text(PAD, cursorY + 10, panel.title, { size: 10, weight: 600, color: palette.text }));
    parts.push(renderLegend(panel, PAD + panel.title.length * 5.8 + 18, cursorY + 10, palette));
    parts.push(renderPanel(panel, geometry, cursorY + PANEL_TITLE_H, palette));
    cursorY += PANEL_TITLE_H + PANEL_H + PANEL_GAP;
  }

  // ── Safety violations ──
  if (payload.violations.length > 0) {
    parts.push(
      text(PAD, cursorY + 10, "Sicherheits-Auffälligkeiten", { size: 10, weight: 600, color: palette.text }),
    );
    cursorY += PANEL_TITLE_H + 8;
    for (const violation of payload.violations) {
      const color = violation.severity === "critical" ? palette.critical : palette.warning;
      parts.push(rect(PAD, cursorY - 8, 3, 10, color));
      parts.push(text(PAD + 10, cursorY, violation.at, { size: 8.5, color: palette.muted }));
      parts.push(text(PAD + 70, cursorY, violation.label, { size: 8.5, weight: 600, color: palette.text }));
      parts.push(text(PAD + 230, cursorY, violation.detail, { size: 8.5, color: palette.muted }));
      cursorY += VIOLATION_ROW_H;
    }
  }

  // ── Footer ──
  parts.push(
    text(PAD, height - 10, `Zählwerk Log Analyzer · erstellt ${payload.generatedAt.slice(0, 10)}`, {
      size: 8,
      color: palette.muted,
    }),
  );
  parts.push(
    text(WIDTH - PAD, height - 10, payload.specSummary, {
      size: 8,
      color: palette.muted,
      anchor: "end",
    }),
  );

  parts.push("</svg>");
  return parts.join("");
}
