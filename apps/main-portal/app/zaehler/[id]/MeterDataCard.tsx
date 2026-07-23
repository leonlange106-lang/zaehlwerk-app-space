"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  FileButton,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableThead,
  TableTh,
  TableTr,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconDownload, IconFileImport } from "@tabler/icons-react";
import { parseCsv } from "../../lib/csv";
import { importReadings, type CsvReadingInput } from "../../lib/backup-actions";

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

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm">
        <IconDownload size={18} stroke={1.6} />
        <Title order={4}>Daten</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Diesen Zähler mit allen Ablesungen und Tarifen exportieren, oder historische Zählerstände aus
        einer CSV importieren.
      </Text>

      <Group>
        <Button
          component="a"
          href={`/api/export/meter?id=${zaehlerId}`}
          download
          variant="light"
          color="slate"
          leftSection={<IconDownload size={16} />}
        >
          Zähler exportieren (JSON)
        </Button>
        <FileButton onChange={handlePick} accept=".csv,text/csv">
          {(props) => (
            <Button {...props} variant="light" color="slate" leftSection={<IconFileImport size={16} />}>
              Ablesungen aus CSV
            </Button>
          )}
        </FileButton>
      </Group>

      {result && (
        <Alert
          mt="md"
          variant="light"
          color={result.ok ? "green" : "red"}
          icon={result.ok ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
        >
          {result.message}
        </Alert>
      )}

      <Modal
        opened={csv !== null}
        onClose={() => !busy && setCsv(null)}
        title="CSV-Spalten zuordnen"
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Group grow>
            <Select label="Datum" data={colOptions} value={datumCol} onChange={(v) => setDatumCol(v ?? "0")} />
            <Select label="Zählerstand" data={colOptions} value={wertCol} onChange={(v) => setWertCol(v ?? "1")} />
          </Group>
          <Group grow>
            <Select
              label="Hinweis / Notiz (optional)"
              data={optionalOptions}
              value={notizCol}
              onChange={(v) => setNotizCol(v ?? NONE)}
            />
            <Select
              label="Zählertausch (optional)"
              data={optionalOptions}
              value={tauschCol}
              onChange={(v) => setTauschCol(v ?? NONE)}
            />
          </Group>

          {csv && (
            <>
              <Text size="xs" c="dimmed">
                Vorschau ({csv.rows.length} Zeilen):
              </Text>
              <Table fz="xs" withTableBorder>
                <TableThead>
                  <TableTr>
                    {csv.headers.map((h, i) => (
                      <TableTh key={i}>{h || `Spalte ${i + 1}`}</TableTh>
                    ))}
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {csv.rows.slice(0, 4).map((row, ri) => (
                    <TableTr key={ri}>
                      {csv.headers.map((_, ci) => (
                        <TableTd key={ci}>{row[ci] ?? ""}</TableTd>
                      ))}
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            </>
          )}

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setCsv(null)} disabled={busy}>
              Abbrechen
            </Button>
            <Button color="slate" loading={busy} onClick={handleConfirm}>
              Ablesungen importieren
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
