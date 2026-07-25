"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/app/components/ui/Button";
import { Field, Select, SelectShell } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import { Alert, FilePicker, Table, TableScroll, Td, Th } from "@/app/components/ui/primitives";
import { IconAlertCircle, IconCheck, IconDownload, IconFileImport } from "@tabler/icons-react";
import { parseCsv } from "@/app/lib/csv";
import { importReadings, type CsvReadingInput } from "@/app/lib/backup-actions";

const NONE = "-1";

function parseNumber(value: string): number {
  const t = value.trim();
  if (t === "") return NaN;
  // Deutsches Format (1.234,56) → Punkt = Tausender, Komma = Dezimal.
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t);
}

function normalizeDate(value: string): string {
  const t = value.trim();
  const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return t;
}

function isTruthy(value: string): boolean {
  return /^(1|true|ja|yes|x|wahr)$/i.test(value.trim());
}

export function MeterDataCard({ zaehlerId }: { zaehlerId: string }) {
  const [csv, setCsv] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [datumCol, setDatumCol] = useState<string>("0");
  const [wertCol, setWertCol] = useState<string>("1");
  const [notizCol, setNotizCol] = useState<string>(NONE);
  const [tauschCol, setTauschCol] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handlePick(picked: File | null) {
    setResult(null);
    if (!picked) return;
    const parsed = parseCsv(await picked.text());
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setResult({ ok: false, message: "Die CSV-Datei enthält keine Datenzeilen." });
      return;
    }
    setCsv(parsed);
    // Heuristik: Spalten anhand der Überschrift vorbelegen.
    const find = (re: RegExp) => parsed.headers.findIndex((h) => re.test(h));
    const d = find(/datum|date/i);
    const w = find(/stand|wert|value|z(ä|ae)hler/i);
    const n = find(/notiz|hinweis|note|kommentar/i);
    const t = find(/tausch|swap|wechsel/i);
    setDatumCol(String(d >= 0 ? d : 0));
    setWertCol(String(w >= 0 ? w : 1));
    setNotizCol(n >= 0 ? String(n) : NONE);
    setTauschCol(t >= 0 ? String(t) : NONE);
  }

  async function handleConfirm() {
    if (!csv) return;
    const di = Number(datumCol);
    const wi = Number(wertCol);
    const ni = Number(notizCol);
    const ti = Number(tauschCol);

    const readings: CsvReadingInput[] = csv.rows
      .map((row) => ({
        datum: normalizeDate(row[di] ?? ""),
        wert: parseNumber(row[wi] ?? ""),
        notiz: ni >= 0 ? row[ni]?.trim() || undefined : undefined,
        zaehlerGetauscht: ti >= 0 ? isTruthy(row[ti] ?? "") : false,
      }))
      .filter((r) => r.datum !== "" && Number.isFinite(r.wert));

    if (readings.length === 0) {
      setResult({ ok: false, message: "Mit dieser Zuordnung ließ sich keine gültige Zeile lesen." });
      return;
    }

    setBusy(true);
    const res = await importReadings(zaehlerId, readings);
    setBusy(false);
    setResult({ ok: res.success, message: res.message });
    if (res.success) setCsv(null);
  }

  const colOptions = (csv?.headers ?? []).map((h, i) => ({ value: String(i), label: h || `Spalte ${i + 1}` }));
  const optionalOptions = [{ value: NONE, label: "— keine —" }, ...colOptions];

  /** One column mapping select. */
  const columnField = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    opts: { value: string; label: string }[],
  ) => (
    <Field label={label}>
      {({ id }) => (
        <SelectShell>
          <Select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
            {opts.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </SelectShell>
      )}
    </Field>
  );

  return (
    <Panel
      title="Daten"
      icon={<IconDownload size={17} stroke={1.7} />}
      description="Diesen Zähler mit allen Ablesungen und Tarifen exportieren, oder historische Zählerstände aus einer CSV importieren."
    >
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/api/export/meter?id=${zaehlerId}`} download>
          <IconDownload size={16} />
          Zähler exportieren (JSON)
        </ButtonLink>
        <FilePicker
          accept=".csv,text/csv"
          onChange={(event) => void handlePick(event.currentTarget.files?.[0] ?? null)}
        >
          <IconFileImport size={16} />
          Ablesungen aus CSV
        </FilePicker>
      </div>

      {result && (
        <Alert
          className="mt-4"
          tone={result.ok ? "ok" : "risk"}
          role={result.ok ? "status" : "alert"}
          icon={result.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
        >
          {result.message}
        </Alert>
      )}

      <ResponsiveDialog
        opened={csv !== null}
        onClose={() => setCsv(null)}
        closeDisabled={busy}
        title="CSV-Spalten zuordnen"
        size="lg"
        footer={
          <>
            <Button type="button" onClick={() => setCsv(null)} disabled={busy}>
              Abbrechen
            </Button>
            <Button type="button" variant="primary" disabled={busy} onClick={handleConfirm}>
              {busy ? "Wird importiert…" : "Ablesungen importieren"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {columnField("Datum", datumCol, setDatumCol, colOptions)}
            {columnField("Zählerstand", wertCol, setWertCol, colOptions)}
            {columnField("Hinweis / Notiz (optional)", notizCol, setNotizCol, optionalOptions)}
            {columnField("Zählertausch (optional)", tauschCol, setTauschCol, optionalOptions)}
          </div>

          {csv && (
            <>
              <p className="text-xs text-dim">Vorschau ({csv.rows.length} Zeilen):</p>
              {/* Scrolls inside the dialog: a wide CSV must not widen the sheet. */}
              <TableScroll className="rounded-control border border-line">
                <Table className="text-xs">
                  <thead>
                    <tr>
                      {csv.headers.map((h, i) => (
                        <Th key={i}>{h || `Spalte ${i + 1}`}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csv.rows.slice(0, 4).map((row, ri) => (
                      <tr key={ri} className="last:[&>td]:border-0">
                        {csv.headers.map((_, ci) => (
                          <Td key={ci} className="whitespace-nowrap">
                            {row[ci] ?? ""}
                          </Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            </>
          )}
        </div>
      </ResponsiveDialog>
    </Panel>
  );
}
