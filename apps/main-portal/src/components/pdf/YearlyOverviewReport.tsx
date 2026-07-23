import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReportMeterRow, YearlyReportData } from "./report-model";

// react-pdf rendert serverseitig in Node — Intl ist verfügbar.
const num1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const eurPerUnit = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const DASH = "–";

function fmtDate(iso: string | null): string {
  return iso ? dateFmt.format(new Date(iso)) : DASH;
}

const styles = StyleSheet.create({
  page: {
    paddingVertical: 28,
    paddingHorizontal: 30,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1a2733",
  },
  header: {
    marginBottom: 14,
    borderBottomWidth: 2,
    borderColor: "#495a6c",
    paddingBottom: 8,
  },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#2c3a47" },
  subtitle: { fontSize: 9, color: "#65788d", marginTop: 3 },
  section: { marginTop: 14 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#2c3a47",
    marginBottom: 5,
  },
  table: { borderWidth: 1, borderColor: "#c9d1d9", borderRadius: 2 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#e5e9ed" },
  lastRow: { borderBottomWidth: 0 },
  headerRow: { backgroundColor: "#495a6c" },
  cell: { paddingVertical: 4, paddingHorizontal: 6 },
  headerCell: { color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  totalRow: { backgroundColor: "#f0f3f6" },
  totalCell: { fontFamily: "Helvetica-Bold" },
  bannerRow: { backgroundColor: "#fbe7d2", borderBottomWidth: 1, borderColor: "#e8a04c" },
  bannerText: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#a85a12",
  },
  // Leerer Stil für die "falsy"-Verzweigung bedingter Style-Arrays —
  // react-pdf akzeptiert (anders als React-DOM) kein `false` im style-Array.
  empty: {},
  alignLeft: { textAlign: "left" },
  alignRight: { textAlign: "right" },
  footnote: { marginTop: 4, fontSize: 7.5, color: "#8a97a3" },
  pageFooter: {
    position: "absolute",
    bottom: 16,
    left: 30,
    right: 30,
    fontSize: 7.5,
    color: "#a0adb8",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

interface Column {
  label: string;
  width: number;
  align?: "left" | "right";
}

type TableRow = { cells: string[]; total?: boolean } | { banner: string };

function alignStyle(align: Column["align"]) {
  return align === "right" ? styles.alignRight : styles.alignLeft;
}

function Table({ columns, rows }: { columns: Column[]; rows: TableRow[] }) {
  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.headerRow]}>
        {columns.map((column, index) => (
          <Text
            key={index}
            style={[styles.cell, styles.headerCell, alignStyle(column.align), { flexGrow: column.width, flexBasis: 0 }]}
          >
            {column.label}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => {
        const isLast = rowIndex === rows.length - 1;
        if ("banner" in row) {
          return (
            <View key={rowIndex} style={[styles.bannerRow, isLast ? styles.lastRow : styles.empty]}>
              <Text style={styles.bannerText}>{row.banner}</Text>
            </View>
          );
        }
        return (
          <View
            key={rowIndex}
            style={[
              styles.row,
              row.total ? styles.totalRow : styles.empty,
              isLast ? styles.lastRow : styles.empty,
            ]}
          >
            {row.cells.map((cell, cellIndex) => (
              <Text
                key={cellIndex}
                style={[
                  styles.cell,
                  alignStyle(columns[cellIndex]?.align),
                  row.total ? styles.totalCell : styles.empty,
                  { flexGrow: columns[cellIndex]?.width ?? 1, flexBasis: 0 },
                ]}
              >
                {cell}
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

// ---------- Sektions-Zeilenbau ----------

function jahresverbrauchRows(rows: ReportMeterRow[]): TableRow[] {
  const out: TableRow[] = [];
  for (const row of rows) {
    out.push({
      cells: [
        row.name,
        row.sparte,
        `${fmtDate(row.periodFrom)} – ${fmtDate(row.periodTo)}`,
        row.firstValue !== null ? num1.format(row.firstValue) : DASH,
        row.lastValue !== null ? num1.format(row.lastValue) : DASH,
        `${num1.format(row.totalConsumption)} ${row.einheit}${row.hasImplausible ? " *" : ""}`,
        row.totalConsumptionKwh !== null ? `${num1.format(row.totalConsumptionKwh)} kWh` : DASH,
      ],
    });
    // Zählertausch als hervorgehobene Trennzeile über die volle Tabellenbreite.
    if (row.meterSwaps.length > 0) {
      out.push({
        banner: `Zählertausch – ${row.name}: ${row.meterSwaps.map((iso) => fmtDate(iso)).join(", ")}`,
      });
    }
  }
  return out;
}

export function YearlyOverviewReport({ data }: { data: YearlyReportData }) {
  const { rows } = data;
  const hasImplausible = rows.some((row) => row.hasImplausible);

  return (
    <Document
      title="Zählwerk Jahresübersicht"
      author="Zählwerk App-Space"
      subject="Strom / Gas / Wasser Übersicht - Jahresverbrauch"
    >
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Strom / Gas / Wasser Übersicht – Jahresverbrauch</Text>
          <Text style={styles.subtitle}>Stand: {dateTimeFmt.format(new Date(data.generatedAt))} Uhr</Text>
        </View>

        {rows.length === 0 ? (
          <Text style={{ color: "#65788d" }}>Keine Zähler vorhanden.</Text>
        ) : (
          <>
            {/* 1. Jahresverbrauch */}
            <Section title="1. Jahresverbrauch">
              <Table
                columns={[
                  { label: "Zähler", width: 3, align: "left" },
                  { label: "Sparte", width: 1.4, align: "left" },
                  { label: "Zeitraum", width: 2.6, align: "left" },
                  { label: "Erste Ablesung", width: 1.6, align: "right" },
                  { label: "Letzte Ablesung", width: 1.6, align: "right" },
                  { label: "Verbrauch", width: 2, align: "right" },
                  { label: "≈ kWh (Gas)", width: 1.8, align: "right" },
                ]}
                rows={jahresverbrauchRows(rows)}
              />
              {hasImplausible && (
                <Text style={styles.footnote}>* enthält unplausible Intervalle (negativer Verbrauch, nicht in der Summe)</Text>
              )}
              <Text style={styles.footnote}>
                Gas-kWh sind eine Näherung (m³ × {num2.format(data.gasKwhFactor)}); ohne
                zählerspezifischen Brennwert.
              </Text>
            </Section>

            {/* 2. Verbrauch pro Tag */}
            <Section title="2. Verbrauch pro Tag">
              <Table
                columns={[
                  { label: "Zähler", width: 3, align: "left" },
                  { label: "Sparte", width: 1.5, align: "left" },
                  { label: "Ø Verbrauch / Tag", width: 2.5, align: "right" },
                ]}
                rows={rows.map((row) => ({
                  cells: [
                    row.name,
                    row.sparte,
                    row.avgPerDay !== null ? `${num2.format(row.avgPerDay)} ${row.einheit}/Tag` : DASH,
                  ],
                }))}
              />
            </Section>

            {/* 3. Kosten pro Tag */}
            <Section title="3. Kosten pro Tag">
              <Table
                columns={[
                  { label: "Zähler", width: 3, align: "left" },
                  { label: "Sparte", width: 1.5, align: "left" },
                  { label: "Kosten / Tag", width: 2.5, align: "right" },
                ]}
                rows={[
                  ...rows.map((row) => ({
                    cells: [
                      row.name,
                      row.sparte,
                      row.costPerDay !== null ? eur.format(row.costPerDay) : DASH,
                    ],
                  })),
                  {
                    cells: ["Gesamtkosten / Tag", "", eur.format(data.totalCostPerDay)],
                    total: true,
                  },
                ]}
              />
            </Section>

            {/* 4. Kosten pro Einheit */}
            <Section title="4. Kosten pro Einheit">
              <Table
                columns={[
                  { label: "Zähler", width: 3, align: "left" },
                  { label: "Sparte", width: 1.5, align: "left" },
                  { label: "Arbeitspreis", width: 2.5, align: "right" },
                ]}
                rows={rows.map((row) => ({
                  cells: [
                    row.name,
                    row.sparte,
                    row.costPerUnit !== null ? `${eurPerUnit.format(row.costPerUnit)} / ${row.einheit}` : DASH,
                  ],
                }))}
              />
            </Section>

            {/* 5. Kosten im Jahr */}
            <Section title="5. Kosten im Jahr">
              <Table
                columns={[
                  { label: "Zähler", width: 3, align: "left" },
                  { label: "Sparte", width: 1.5, align: "left" },
                  { label: "Kosten gesamt", width: 2.5, align: "right" },
                ]}
                rows={[
                  ...rows.map((row) => ({
                    cells: [row.name, row.sparte, eur.format(row.totalCost)],
                  })),
                  {
                    cells: ["Jahres-Gesamtsumme", "", eur.format(data.grandTotalCost)],
                    total: true,
                  },
                ]}
              />
            </Section>
          </>
        )}

        <View style={styles.pageFooter} fixed>
          <Text>Zählwerk App-Space – automatisch generierter Bericht</Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
