import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReportRow, UtilityCell, YearlyReportData } from "./report-model";

// react-pdf rendert serverseitig in Node — Intl ist verfügbar.
const num0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function currency(value: number, dm: boolean): string {
  return `${num2.format(value)} ${dm ? "DM" : "€"}`;
}

const styles = StyleSheet.create({
  page: { paddingVertical: 28, paddingHorizontal: 34, fontSize: 9, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { marginBottom: 12 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 10, textAlign: "right", marginTop: 2, color: "#333333" },
  sectionTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 5 },
  table: {},
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#e8e8e8" },
  headerRow: { backgroundColor: "#dcdcdc", borderBottomWidth: 0 },
  cell: { paddingVertical: 3, paddingHorizontal: 5, flexBasis: 0 },
  headerCell: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  dateCell: { fontFamily: "Helvetica-Bold" },
  cellText: { fontSize: 9 },
  cellSub: { fontSize: 6.5, color: "#b0b0b0", marginTop: 1 },
  red: { color: "#ff0000" },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#e8940c" },
  empty: {},
  footnote: { marginTop: 6, fontSize: 7, color: "#8a8a8a" },
  pageFooter: {
    position: "absolute",
    bottom: 16,
    left: 34,
    right: 34,
    fontSize: 7,
    color: "#a0a0a0",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  extraTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 4 },
});

interface CellDesc {
  text: string;
  sub?: string;
  red?: boolean;
  bold?: boolean;
  muted?: boolean;
}

interface Column {
  label: string;
  width: number;
}

interface TableRow {
  date: string;
  cells: CellDesc[];
}

function DateTable({ columns, rows }: { columns: Column[]; rows: TableRow[] }) {
  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.headerRow]}>
        {columns.map((column, index) => (
          <Text key={index} style={[styles.cell, styles.headerCell, { flexGrow: column.width }]}>
            {column.label}
          </Text>
        ))}
      </View>
      {rows.map((row) => (
        <View key={row.date} style={styles.row} wrap={false}>
          <Text style={[styles.cell, styles.dateCell, { flexGrow: columns[0].width }]}>
            {fmtDate(row.date)}
          </Text>
          {row.cells.map((cell, index) => (
            <View key={index} style={[styles.cell, { flexGrow: columns[index + 1]?.width ?? 1 }]}>
              <Text
                style={[
                  styles.cellText,
                  cell.red ? styles.red : styles.empty,
                  cell.bold ? styles.bold : styles.empty,
                  cell.muted ? styles.muted : styles.empty,
                ]}
              >
                {cell.text}
              </Text>
              {cell.sub ? <Text style={styles.cellSub}>{cell.sub}</Text> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ---- Zell-Erzeuger je Sektion ----
// Gemeinsame Sonderfälle: keine Ablesung → leer, Zählertausch → rot,
// unplausibler (negativer) Verbrauch → markiert.

function verbrauchCell(cell: UtilityCell | null, gas: boolean): CellDesc {
  if (!cell) return { text: "" };
  if (cell.swap) return { text: "Zählertausch", red: true };
  if (cell.consumption === null) return { text: "unplausibel", muted: true };
  return {
    text: num1.format(cell.consumption),
    sub: gas && cell.consumptionKwh !== null ? `${num0.format(cell.consumptionKwh)} kWh` : undefined,
  };
}

function proTagCell(cell: UtilityCell | null, gas: boolean): CellDesc {
  if (!cell) return { text: "" };
  if (cell.swap) return { text: "Zählertausch", red: true };
  if (cell.consumption === null) return { text: "unplausibel", muted: true };
  const perDay = cell.days > 0 ? cell.consumption / cell.days : 0;
  const kwhPerDay =
    gas && cell.consumptionKwh !== null && cell.days > 0 ? cell.consumptionKwh / cell.days : null;
  return {
    text: num2.format(perDay),
    sub: `${cell.days} T${kwhPerDay !== null ? ` · ${num2.format(kwhPerDay)} kWh` : ""}`,
  };
}

function kostenProTagCell(cell: UtilityCell | null, dm: boolean): CellDesc {
  if (!cell) return { text: "" };
  if (cell.swap) return { text: "Zählertausch", red: true };
  if (cell.cost === null || cell.days <= 0) return { text: "" };
  return { text: currency(cell.cost / cell.days, dm), sub: `${cell.days} T` };
}

function kostenProEinheitCell(cell: UtilityCell | null, dm: boolean): CellDesc {
  if (!cell) return { text: "" };
  if (cell.swap) return { text: "Zählertausch", red: true };
  if (cell.cost === null || cell.consumption === null || cell.consumption <= 0) return { text: "" };
  return { text: currency(cell.cost / cell.consumption, dm) };
}

function kostenJahrCell(cell: UtilityCell | null, dm: boolean): CellDesc {
  if (!cell) return { text: "" };
  if (cell.swap) return { text: "Zählertausch", red: true };
  if (cell.cost === null) return { text: "" };
  return { text: currency(cell.cost, dm) };
}

function rowHasSwap(row: ReportRow): boolean {
  return Boolean(row.strom?.swap || row.gas?.swap || row.wasser?.swap);
}

function gesamtCell(row: ReportRow, perDay: boolean): CellDesc {
  if (rowHasSwap(row)) return { text: "-", red: true, bold: true };
  let sum = 0;
  let any = false;
  for (const cell of [row.strom, row.gas, row.wasser]) {
    if (!cell || cell.cost === null) continue;
    if (perDay) {
      if (cell.days > 0) {
        sum += cell.cost / cell.days;
        any = true;
      }
    } else {
      sum += cell.cost;
      any = true;
    }
  }
  if (!any) return { text: "" };
  return { text: currency(sum, row.dm), bold: true };
}

function Section({
  title,
  columns,
  rows,
  breakBefore,
}: {
  title: string;
  columns: Column[];
  rows: TableRow[];
  breakBefore?: boolean;
}) {
  return (
    <View break={breakBefore}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <DateTable columns={columns} rows={rows} />
    </View>
  );
}

const U3 = 26;
const D3 = 22;
const U4 = 20.5;
const D4 = 18;

export function YearlyOverviewReport({ data }: { data: YearlyReportData }) {
  const { rows } = data;
  const hasRows = rows.length > 0;

  return (
    <Document
      title="Strom/Gas/Wasser Übersicht"
      author="Zählwerk App-Space"
      subject="Strom / Gas / Wasser Übersicht - Jahresverbrauch"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Strom/Gas/Wasser Übersicht</Text>
          <Text style={styles.subtitle}>Stand: {dateTimeFmt.format(new Date(data.generatedAt))} Uhr</Text>
        </View>

        {!hasRows ? (
          <Text style={{ color: "#666666" }}>
            Keine Ablesungen für Strom, Gas oder Wasser vorhanden.
          </Text>
        ) : (
          <>
            <Section
              title="Jahresverbrauch"
              columns={[
                { label: "Datum", width: D3 },
                { label: "Strom in kW", width: U3 },
                { label: "Gas in m³", width: U3 },
                { label: "Wasser in m³", width: U3 },
              ]}
              rows={rows.map((r) => ({
                date: r.date,
                cells: [verbrauchCell(r.strom, false), verbrauchCell(r.gas, true), verbrauchCell(r.wasser, false)],
              }))}
            />

            <Section
              title="Verbrauch pro Tag"
              breakBefore
              columns={[
                { label: "Datum", width: D3 },
                { label: "Strom kW/Tag", width: U3 },
                { label: "Gas m³/Tag", width: U3 },
                { label: "Wasser m³/Tag", width: U3 },
              ]}
              rows={rows.map((r) => ({
                date: r.date,
                cells: [proTagCell(r.strom, false), proTagCell(r.gas, true), proTagCell(r.wasser, false)],
              }))}
            />

            <Section
              title="Kosten pro Tag"
              breakBefore
              columns={[
                { label: "Datum", width: D4 },
                { label: "Strom K/Tag", width: U4 },
                { label: "Gas K/Tag", width: U4 },
                { label: "Wasser K/Tag", width: U4 },
                { label: "Gesamt K/Tag", width: U4 },
              ]}
              rows={rows.map((r) => ({
                date: r.date,
                cells: [
                  kostenProTagCell(r.strom, r.dm),
                  kostenProTagCell(r.gas, r.dm),
                  kostenProTagCell(r.wasser, r.dm),
                  gesamtCell(r, true),
                ],
              }))}
            />

            <Section
              title="Kosten pro Einheit"
              breakBefore
              columns={[
                { label: "Datum", width: D3 },
                { label: "Strom K/kW", width: U3 },
                { label: "Gas K/m³", width: U3 },
                { label: "Wasser K/m³", width: U3 },
              ]}
              rows={rows.map((r) => ({
                date: r.date,
                cells: [
                  kostenProEinheitCell(r.strom, r.dm),
                  kostenProEinheitCell(r.gas, r.dm),
                  kostenProEinheitCell(r.wasser, r.dm),
                ],
              }))}
            />

            <Section
              title="Kosten im Jahr"
              breakBefore
              columns={[
                { label: "Datum", width: D4 },
                { label: "Strom", width: U4 },
                { label: "Gas", width: U4 },
                { label: "Wasser", width: U4 },
                { label: "Gesamt", width: U4 },
              ]}
              rows={rows.map((r) => ({
                date: r.date,
                cells: [
                  kostenJahrCell(r.strom, r.dm),
                  kostenJahrCell(r.gas, r.dm),
                  kostenJahrCell(r.wasser, r.dm),
                  gesamtCell(r, false),
                ],
              }))}
            />

            {/* Bei Gas ist die Umrechnung ein Teil der Rechnung. Wer diesen
                Bericht spaeter gegen eine Jahresrechnung haelt, muss sehen
                koennen, mit welchen Zahlen gerechnet wurde — und ob sie
                gepflegt oder angenommen waren. */}
            <Text style={styles.footnote}>
              Gas-kWh = m³ × Brennwert × Zustandszahl.{" "}
              {data.gasFaktoren.length > 0
                ? `Verwendet: ${data.gasFaktoren
                    .map(
                      (faktor) =>
                        `${num2.format(faktor.brennwert)} × ${num2.format(faktor.zustandszahl)} ` +
                        `(ab ${faktor.von}${faktor.bis ? ` bis ${faktor.bis}` : ""})`,
                    )
                    .join("; ")}.`
                : `Kein Faktor gepflegt — gerechnet mit der festen Annahme ${num2.format(
                    data.gasBrennwert,
                  )} × ${num2.format(data.gasZustandszahl)} (Stand 2021).`}{" "}
              Kosten vor dem 18.09.2001 in DM.
              {data.columns.strom || data.columns.gas || data.columns.wasser
                ? ` Zähler: Strom „${data.columns.strom ?? "–"}“, Gas „${data.columns.gas ?? "–"}“, Wasser „${data.columns.wasser ?? "–"}“.`
                : ""}
            </Text>
          </>
        )}

        {data.extras.length > 0 && (
          <View break>
            <Text style={styles.extraTitle}>Weitere Zähler</Text>
            <View style={styles.table}>
              <View style={[styles.row, styles.headerRow]}>
                <Text style={[styles.cell, styles.headerCell, { flexGrow: 3 }]}>Zähler</Text>
                <Text style={[styles.cell, styles.headerCell, { flexGrow: 1.5 }]}>Sparte</Text>
                <Text style={[styles.cell, styles.headerCell, { flexGrow: 2 }]}>Verbrauch gesamt</Text>
                <Text style={[styles.cell, styles.headerCell, { flexGrow: 2 }]}>Kosten gesamt</Text>
              </View>
              {data.extras.map((meter) => (
                <View key={meter.id} style={styles.row} wrap={false}>
                  <Text style={[styles.cell, styles.cellText, { flexGrow: 3 }]}>{meter.name}</Text>
                  <Text style={[styles.cell, styles.cellText, { flexGrow: 1.5 }]}>{meter.sparte}</Text>
                  <Text style={[styles.cell, styles.cellText, { flexGrow: 2 }]}>
                    {num1.format(meter.totalConsumption)} {meter.einheit}
                    {meter.totalConsumptionKwh !== null ? ` (${num0.format(meter.totalConsumptionKwh)} kWh)` : ""}
                  </Text>
                  <Text style={[styles.cell, styles.cellText, { flexGrow: 2 }]}>{num2.format(meter.totalCost)} €</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.pageFooter} fixed>
          <Text>Zählwerk App-Space – automatisch generierter Bericht</Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
