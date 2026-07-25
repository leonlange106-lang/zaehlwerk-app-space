import {
  Document,
  Line,
  Page,
  Polyline,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import {
  buildPanelGeometry,
  pointsAttr,
  type PanelGeometry,
} from "@/app/apps/log-analyzer/lib/report-chart";
import { PALETTES, statusColor, type ReportPalette } from "@/app/apps/log-analyzer/lib/report-svg";
import {
  fmtNum,
  type ReportChartPanel,
  type ReportMetric,
  type ReportPayload,
} from "@/app/apps/log-analyzer/lib/report-generator";

// The printable log report. Renders the payload built by report-generator.ts
// into an A4 document: header + metadata, the health verdict with its key
// figures, the WOT-pull charts, the safety-violation table, the virtual-dyno
// summary and the raw-file summary — each section independently optional.
//
// The charts are drawn with react-pdf's SVG primitives from exactly the same
// geometry the browser's PNG export uses (report-chart.ts), so the two artefacts
// are the same picture in two containers. Nothing here computes chart maths.
//
// Only the built-in Helvetica faces are used: registering an external font would
// mean a network fetch at render time inside the container, which is precisely
// the kind of failure a report route must not have.

const A4_CONTENT_WIDTH = 527; // 595pt A4 minus 2 × 34pt margins
const PANEL_HEIGHT = 108;

function makeStyles(palette: ReportPalette) {
  return StyleSheet.create({
    page: {
      paddingVertical: 30,
      paddingHorizontal: 34,
      fontSize: 9,
      fontFamily: "Helvetica",
      color: palette.text,
      backgroundColor: palette.background,
    },
    title: { fontSize: 18, fontFamily: "Helvetica-Bold" },
    metaLine: { fontSize: 9, color: palette.muted, marginTop: 3 },
    hash: { fontSize: 6.5, color: palette.muted, marginTop: 3 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    badge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 3 },
    badgeText: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#ffffff" },
    healthText: { fontSize: 8, color: palette.muted, marginTop: 4, textAlign: "right" },
    rule: { borderBottomWidth: 1, borderColor: palette.border, marginTop: 10, marginBottom: 12 },
    sectionTitle: {
      fontSize: 11,
      fontFamily: "Helvetica-Bold",
      marginTop: 14,
      marginBottom: 6,
      color: palette.text,
    },
    metricRow: { flexDirection: "row", gap: 8 },
    metricTile: {
      flexGrow: 1,
      flexBasis: 0,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      borderRadius: 3,
      padding: 7,
    },
    metricLabel: { fontSize: 6.5, color: palette.muted, fontFamily: "Helvetica-Bold" },
    metricValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 3 },
    metricHint: { fontSize: 6.5, color: palette.muted, marginTop: 2 },
    panelTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 2 },
    legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 3 },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
    legendSwatch: { width: 11, height: 2 },
    legendLabel: { fontSize: 7, color: palette.muted },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: palette.surface,
      borderBottomWidth: 1,
      borderColor: palette.border,
    },
    tableRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: palette.border },
    cell: { paddingVertical: 3, paddingHorizontal: 4, fontSize: 8, flexBasis: 0 },
    cellHead: { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: palette.muted },
    infoRow: { flexDirection: "row", flexWrap: "wrap" },
    infoItem: { width: "25%", paddingVertical: 3, paddingRight: 6 },
    infoLabel: { fontSize: 6.5, color: palette.muted, fontFamily: "Helvetica-Bold" },
    infoValue: { fontSize: 9, marginTop: 1 },
    note: { fontSize: 7.5, color: palette.muted, marginTop: 3 },
    empty: { fontSize: 9, color: palette.muted, marginTop: 2 },
    footer: {
      position: "absolute",
      bottom: 16,
      left: 34,
      right: 34,
      fontSize: 7,
      color: palette.muted,
      flexDirection: "row",
      justifyContent: "space-between",
    },
  });
}

type Styles = ReturnType<typeof makeStyles>;

function MetricTiles({ metrics, styles }: { metrics: ReportMetric[]; styles: Styles }) {
  return (
    <View style={styles.metricRow}>
      {metrics.map((metric) => (
        <View key={metric.label} style={styles.metricTile}>
          <Text style={styles.metricLabel}>{metric.label.toUpperCase()}</Text>
          <Text style={styles.metricValue}>{metric.value}</Text>
          {metric.hint ? <Text style={styles.metricHint}>{metric.hint}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** One chart panel: legend above, SVG plot below. */
function ChartPanel({
  panel,
  geometry,
  palette,
  styles,
}: {
  panel: ReportChartPanel;
  geometry: PanelGeometry;
  palette: ReportPalette;
  styles: Styles;
}) {
  const { plot } = geometry;
  return (
    <View wrap={false}>
      <Text style={styles.panelTitle}>{panel.title}</Text>
      <View style={styles.legendRow}>
        {panel.series.map((series) => (
          <View key={series.key} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: series.color }]} />
            <Text style={styles.legendLabel}>
              {series.label}
              {series.dashed ? " (gestrichelt)" : ""}
            </Text>
          </View>
        ))}
      </View>
      <Svg width={geometry.width} height={geometry.height}>
        <Rect
          x={plot.x}
          y={plot.y}
          width={plot.width}
          height={plot.height}
          fill={palette.surface}
          stroke={palette.border}
          strokeWidth={0.5}
        />
        {geometry.band ? (
          <Rect
            x={geometry.band.x}
            y={plot.y}
            width={geometry.band.width}
            height={plot.height}
            fill={palette.accent}
            fillOpacity={0.1}
          />
        ) : null}

        {geometry.leftTicks.map((tick) => (
          <Line
            key={`grid-${tick.value}`}
            x1={plot.x}
            y1={tick.pos}
            x2={plot.x + plot.width}
            y2={tick.pos}
            stroke={palette.grid}
            strokeWidth={0.4}
          />
        ))}
        {geometry.leftTicks.map((tick) => (
          <Text
            key={`lt-${tick.value}`}
            x={plot.x - 4}
            y={tick.pos + 2.5}
            textAnchor="end"
            style={{ fontSize: 6, fill: palette.muted }}
          >
            {tick.label}
          </Text>
        ))}
        {geometry.rightTicks.map((tick) => (
          <Text
            key={`rt-${tick.value}`}
            x={plot.x + plot.width + 4}
            y={tick.pos + 2.5}
            textAnchor="start"
            style={{ fontSize: 6, fill: palette.muted }}
          >
            {tick.label}
          </Text>
        ))}
        {geometry.xTicks.map((tick) => (
          <Text
            key={`xt-${tick.value}`}
            x={tick.pos}
            y={plot.y + plot.height + 9}
            textAnchor="middle"
            style={{ fontSize: 6, fill: palette.muted }}
          >
            {tick.label}
          </Text>
        ))}

        {/* Violation markers sit beneath the traces so data always stays legible. */}
        {geometry.markers.map((marker, index) => (
          <Line
            key={`m-${index}`}
            x1={marker.x}
            y1={plot.y}
            x2={marker.x}
            y2={plot.y + plot.height}
            stroke={marker.severity === "critical" ? palette.critical : palette.warning}
            strokeWidth={0.8}
            strokeDasharray="3 2"
          />
        ))}

        {geometry.lines.flatMap((line) =>
          line.segments
            .filter((segment) => segment.length > 1)
            .map((segment, index) => (
              <Polyline
                key={`${line.key}-${index}`}
                points={pointsAttr(segment)}
                fill="none"
                stroke={line.color}
                strokeWidth={1.1}
                strokeDasharray={line.dashed ? "3 2" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )),
        )}
      </Svg>
    </View>
  );
}

function InfoGrid({ items, styles }: { items: ReportMetric[]; styles: Styles }) {
  return (
    <View style={styles.infoRow}>
      {items.map((item) => (
        <View key={item.label} style={styles.infoItem}>
          <Text style={styles.infoLabel}>{item.label.toUpperCase()}</Text>
          <Text style={styles.infoValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function LogAnalyzerReport({ payload }: { payload: ReportPayload }) {
  const palette = PALETTES[payload.theme];
  const styles = makeStyles(palette);
  const badgeColor = statusColor(payload, palette);

  const metaLine = [
    payload.meta.vehicle,
    payload.meta.platform === "unknown" ? null : payload.meta.platformLabel,
    payload.meta.mapVersion,
    payload.meta.software,
    payload.meta.loggedAt,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const panels = payload.panels
    .map((panel) => ({ panel, geometry: buildPanelGeometry(panel, A4_CONTENT_WIDTH, PANEL_HEIGHT) }))
    .filter((entry): entry is { panel: ReportChartPanel; geometry: PanelGeometry } => entry.geometry !== null);

  const dynoGeometry = payload.dynoPanel
    ? buildPanelGeometry(payload.dynoPanel, A4_CONTENT_WIDTH, PANEL_HEIGHT + 20)
    : null;

  return (
    <Document
      title={`Logbericht – ${payload.title}`}
      author="Zählwerk App-Space"
      subject="Log Analyzer – Auswertungsbericht"
    >
      <Page size="A4" style={styles.page}>
        {/* ── Header ── */}
        <View style={styles.headerRow}>
          <View style={{ flexGrow: 1, paddingRight: 12 }}>
            <Text style={styles.title}>{payload.title}</Text>
            <Text style={styles.metaLine}>{metaLine || "Keine Fahrzeug-Metadaten im Log"}</Text>
            {payload.meta.vin ? <Text style={styles.metaLine}>VIN: {payload.meta.vin}</Text> : null}
            {payload.meta.contentHash ? (
              <Text style={styles.hash}>SHA-256: {payload.meta.contentHash}</Text>
            ) : null}
          </View>
          <View>
            <View style={[styles.badge, { backgroundColor: badgeColor }]}>
              <Text style={styles.badgeText}>{payload.verdict.statusLabel}</Text>
            </View>
            <Text style={styles.healthText}>{payload.verdict.healthLabel}</Text>
          </View>
        </View>
        <View style={styles.rule} />

        {/* ── Verdict ── */}
        <Text style={styles.sectionTitle}>Gesamtbewertung</Text>
        <MetricTiles metrics={payload.verdict.metrics} styles={styles} />
        {payload.verdict.reasons.length > 0 ? (
          <View>
            {payload.verdict.reasons.map((reason) => (
              <Text key={reason} style={styles.note}>
                • {reason}
              </Text>
            ))}
          </View>
        ) : null}
        <Text style={styles.note}>Bewertet gegen: {payload.specSummary}</Text>

        {/* ── WOT charts ── */}
        {payload.sections.wotChart ? (
          <View>
            <Text style={styles.sectionTitle}>WOT-Pull</Text>
            {panels.length > 0 ? (
              panels.map(({ panel, geometry }) => (
                <ChartPanel
                  key={panel.id}
                  panel={panel}
                  geometry={geometry}
                  palette={palette}
                  styles={styles}
                />
              ))
            ) : (
              <Text style={styles.empty}>
                Keine darstellbaren Kanäle im erkannten Pull-Fenster.
              </Text>
            )}
          </View>
        ) : null}

        {/* ── Safety violations ── */}
        {payload.sections.violations ? (
          <View break={panels.length > 2}>
            <Text style={styles.sectionTitle}>Sicherheits-Auffälligkeiten</Text>
            {payload.violations.length > 0 ? (
              <View>
                <View style={styles.tableHeader}>
                  <Text style={[styles.cell, styles.cellHead, { flexGrow: 1.2 }]}>Zeitpunkt</Text>
                  <Text style={[styles.cell, styles.cellHead, { flexGrow: 1.2 }]}>Schwere</Text>
                  <Text style={[styles.cell, styles.cellHead, { flexGrow: 3 }]}>Auffälligkeit</Text>
                  <Text style={[styles.cell, styles.cellHead, { flexGrow: 4 }]}>Messwert</Text>
                </View>
                {payload.violations.map((violation, index) => (
                  <View key={`${violation.label}-${index}`} style={styles.tableRow} wrap={false}>
                    <Text style={[styles.cell, { flexGrow: 1.2 }]}>{violation.at}</Text>
                    <Text
                      style={[
                        styles.cell,
                        {
                          flexGrow: 1.2,
                          color: violation.severity === "critical" ? palette.critical : palette.warning,
                          fontFamily: "Helvetica-Bold",
                        },
                      ]}
                    >
                      {violation.severity === "critical" ? "Kritisch" : "Warnung"}
                    </Text>
                    <Text style={[styles.cell, { flexGrow: 3 }]}>{violation.label}</Text>
                    <Text style={[styles.cell, { flexGrow: 4 }]}>{violation.detail}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.empty}>
                Keine Grenzwertüberschreitungen im Pull-Fenster erkannt.
              </Text>
            )}
          </View>
        ) : null}

        {/* ── Virtual dyno ── */}
        {payload.dyno ? (
          <View break>
            <Text style={styles.sectionTitle}>Leistungsschätzung (Virtueller Prüfstand)</Text>
            <MetricTiles
              metrics={[
                {
                  label: "Max. Leistung",
                  value: payload.dyno.peakPs === null ? "—" : `${fmtNum(payload.dyno.peakPs)} PS`,
                  hint:
                    payload.dyno.peakPowerRpm === null
                      ? undefined
                      : `bei ${fmtNum(payload.dyno.peakPowerRpm)} 1/min`,
                },
                {
                  label: "Max. Leistung (kW)",
                  value: payload.dyno.peakKw === null ? "—" : `${fmtNum(payload.dyno.peakKw, 1)} kW`,
                  hint: payload.dyno.output,
                },
                {
                  label: "Max. Drehmoment",
                  value: payload.dyno.peakNm === null ? "—" : `${fmtNum(payload.dyno.peakNm)} Nm`,
                  hint:
                    payload.dyno.peakTorqueRpm === null
                      ? undefined
                      : `bei ${fmtNum(payload.dyno.peakTorqueRpm)} 1/min`,
                },
                {
                  label: "Korrektur",
                  value: payload.dyno.correction,
                  hint:
                    payload.dyno.correctionFactor === null
                      ? "unkorrigiert"
                      : `Faktor ×${payload.dyno.correctionFactor.toFixed(3)}`,
                },
              ]}
              styles={styles}
            />
            <Text style={styles.note}>
              Methode: {payload.dyno.method} · Datenbasis: {payload.dyno.source} · Umgebung:{" "}
              {payload.dyno.ambient}
            </Text>
            {payload.dynoPanel && dynoGeometry ? (
              <ChartPanel
                panel={payload.dynoPanel}
                geometry={dynoGeometry}
                palette={palette}
                styles={styles}
              />
            ) : null}
            {payload.dyno.notes.map((note) => (
              <Text key={note} style={styles.note}>
                • {note}
              </Text>
            ))}
            <Text style={styles.note}>
              Alle Leistungswerte sind rechnerische Schätzungen aus dem Datenlog – kein Ersatz für
              einen realen Prüfstandslauf.
            </Text>
          </View>
        ) : null}

        {/* ── Raw file summary ── */}
        {payload.fileSummary.length > 0 ? (
          <View wrap={false}>
            <Text style={styles.sectionTitle}>Log-Datei</Text>
            <InfoGrid items={payload.fileSummary} styles={styles} />
            {payload.meta.source ? (
              <Text style={styles.note}>Quelle: {payload.meta.source}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>
            Zählwerk App-Space · Log Analyzer · erstellt {payload.generatedAt.slice(0, 10)}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
