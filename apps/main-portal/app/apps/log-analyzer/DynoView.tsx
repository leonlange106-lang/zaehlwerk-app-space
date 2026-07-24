"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAdjustments,
  IconAlertCircle,
  IconFileExport,
  IconFileText,
  IconGauge,
  IconInfoCircle,
  IconSparkles,
} from "@tabler/icons-react";
import { parseLog } from "./lib/log-parser";
import { makeSampleCsv } from "./lib/sample-log";
import { fetchLog, fetchLogs, type LogSummaryDTO } from "./lib/log-api";
import { takeActiveLogId } from "./lib/log-store";
import {
  buildDynoChartRows,
  CORRECTION_LABELS,
  estimateDyno,
  METHOD_LABELS,
  OUTPUT_LABELS,
  powerOf,
  type CorrectionStandard,
  type DynoOutput,
  type DynoPoint,
  type MethodPreference,
} from "./lib/dyno-engine";
import {
  applyVehicleEngine,
  DEFAULT_DYNO_PROFILE,
  summarizeDynoProfile,
  type DynoProfile,
} from "./lib/dyno-spec";
import { loadDynoProfile } from "./lib/dyno-store";
import { loadVehicleSpec } from "./lib/spec-store";
import { DEFAULT_VEHICLE_SPEC, type VehicleSpec } from "./lib/vehicle-spec";
import type { ParsedLog } from "./lib/types";
import { DynoChart } from "./DynoChart";
import { DynoProfileDrawer } from "./DynoProfileDrawer";
import { ExportModal } from "./ExportModal";
import { LegendItem, SERIES_COLORS } from "./ChartLegend";
import { XS_INPUT_HEIGHT } from "./ui-metrics";

// The virtual dyno workspace: pick a log, and its detected WOT pull is turned
// into power and torque curves over engine speed. All physics lives in the pure
// engine (dyno-engine.ts) and all vehicle data in the profile (dyno-spec.ts);
// this component only orchestrates picking, toggling and rendering.

interface Active {
  /** Id when the log came from the store; null for a file picked locally. */
  id: string | null;
  name: string;
  /** Raw CSV, kept so a report can be generated for an unpersisted file too. */
  csv: string;
  log: ParsedLog;
}

const METHOD_OPTIONS: { value: MethodPreference; label: string }[] = [
  { value: "auto", label: "Automatisch" },
  { value: "airmass", label: METHOD_LABELS.airmass },
  { value: "acceleration", label: METHOD_LABELS.acceleration },
];

const CORRECTION_OPTIONS: { value: CorrectionStandard; label: string }[] = (
  Object.keys(CORRECTION_LABELS) as CorrectionStandard[]
).map((value) => ({ value, label: CORRECTION_LABELS[value] }));

const OUTPUT_OPTIONS: { value: DynoOutput; label: string }[] = (
  Object.keys(OUTPUT_LABELS) as DynoOutput[]
).map((value) => ({ value, label: OUTPUT_LABELS[value] }));

function fmt(value: number, digits = 0): string {
  return value.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function DynoView() {
  const [active, setActive] = useState<Active | null>(null);
  const [history, setHistory] = useState<LogSummaryDTO[]>([]);
  // Only picks skeleton vs. control — the picker row is reserved either way.
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<DynoProfile>(DEFAULT_DYNO_PROFILE);
  const [spec, setSpec] = useState<VehicleSpec>(DEFAULT_VEHICLE_SPEC);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [method, setMethod] = useState<MethodPreference>("auto");
  const [correction, setCorrection] = useState<CorrectionStandard>("none");
  const [output, setOutput] = useState<DynoOutput>("crank");

  // The vehicle-dynamics profile and the hardware spec both live in
  // localStorage (client-only), so they are read after mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(loadDynoProfile());
    setSpec(loadVehicleSpec());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const logs = await fetchLogs();
        if (!cancelled) setHistory(logs);
      } catch {
        // non-fatal — the file picker still works without the stored list
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openById = useCallback(async (id: string) => {
    try {
      const record = await fetchLog(id);
      if (!record) {
        setError("Log nicht gefunden.");
        return;
      }
      setError(null);
      setActive({ id: record.id, name: record.name, csv: record.csv, log: parseLog(record.csv) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Log konnte nicht geladen werden.");
    }
  }, []);

  // Pick up a log handed over from the Analyzer (one-shot).
  useEffect(() => {
    const handedId = takeActiveLogId();
    // openById only setState()s after an async fetch, never synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (handedId) void openById(handedId);
  }, [openById]);

  const ingest = useCallback((name: string, csv: string) => {
    try {
      const log = parseLog(csv);
      if (log.rowCount === 0) {
        setError("Die Datei enthält keine auswertbaren Datenzeilen.");
        return;
      }
      setError(null);
      setActive({ id: null, name, csv, log });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Die Datei konnte nicht gelesen werden.");
    }
  }, []);

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (!/\.csv$|\.log$|\.txt$/i.test(file.name)) {
        setError("Bitte eine .csv-Datei auswählen.");
        return;
      }
      ingest(file.name, await file.text());
    },
    [ingest],
  );

  // Only a verified WOT pull produces a meaningful power curve: a part-throttle
  // or aborted run understates the airflow and the acceleration alike, so those
  // logs are kept out of the picker rather than silently mis-measured.
  const verifiedHistory = useMemo(
    () => history.filter((h) => h.status === "verified"),
    [history],
  );

  // The engine is a property of the car, so it comes from the vehicle profile
  // rather than being configured twice; everything else stays the user's.
  const effectiveProfile = useMemo(
    () => applyVehicleEngine(profile, spec.engineCode),
    [profile, spec.engineCode],
  );

  const estimate = useMemo(
    () => (active ? estimateDyno(active.log, effectiveProfile, { correction, method }) : null),
    [active, effectiveProfile, correction, method],
  );
  const rows = useMemo(
    () => (estimate ? buildDynoChartRows(estimate, output) : []),
    [estimate, output],
  );

  const curve = estimate?.primary ?? null;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="md">
          <ThemeIcon variant="light" color="orange" radius="md" size={44}>
            <IconGauge size={24} stroke={1.5} />
          </ThemeIcon>
          <div>
            <Title order={2}>Virtueller Prüfstand</Title>
            <Text c="dimmed" size="sm">
              Leistung und Drehmoment aus dem WOT-Pull schätzen – Luftmasse und Fahrdynamik.
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          {/* Always mounted, disabled until a log is open: a log handed over
              from the Analyzer arrives asynchronously, and a button appearing
              at that moment would push the header around on narrow screens. */}
          <Button
            variant="light"
            color="teal"
            leftSection={<IconFileExport size={16} />}
            onClick={() => setExportOpen(true)}
            disabled={!active}
            data-testid="open-export"
          >
            Exportieren / Bericht erstellen
          </Button>
          <Button
            variant="light"
            color="slate"
            leftSection={<IconAdjustments size={16} />}
            onClick={() => setDrawerOpen(true)}
            data-testid="dyno-open-profile"
          >
            Fahrzeug-Parameter
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card withBorder radius="md" p="md">
        <Group justify="space-between" mb="sm" wrap="nowrap">
          <Text fw={600} size="sm" lineClamp={1}>
            {active ? active.name : "Log wählen"}
          </Text>
          {active && (
            <Badge variant="light" color="orange" data-testid="dyno-log-badge">
              {active.log.rowCount.toLocaleString("de-DE")} Zeilen
            </Badge>
          )}
        </Group>
        <Group gap="sm" align="flex-end" wrap="wrap">
          {/* Reserved either way: a Select that only mounts once the stored-log
              list arrives reflows the whole row (and eats clicks) mid-load. */}
          {historyLoading ? (
            <Skeleton height={XS_INPUT_HEIGHT} w={260} radius="sm" data-testid="dyno-history-skeleton" />
          ) : (
            <Select
              placeholder={
                verifiedHistory.length > 0
                  ? "Verifizierten Pull wählen…"
                  : "Keine verifizierten Pulls"
              }
              data={verifiedHistory.map((h) => ({ value: h.id, label: h.name }))}
              disabled={verifiedHistory.length === 0}
              onChange={(id) => id && void openById(id)}
              searchable
              clearable
              size="xs"
              w={260}
              data-testid="dyno-history"
            />
          )}
          <FileButton onChange={(f) => void handleFile(f)} accept=".csv,.log,.txt,text/csv,text/plain">
            {(props) => (
              <Button {...props} size="xs" variant="light" color="orange" leftSection={<IconFileText size={14} />}>
                Datei
              </Button>
            )}
          </FileButton>
          <Button
            size="xs"
            variant="subtle"
            color="slate"
            leftSection={<IconSparkles size={14} />}
            onClick={() => ingest("Beispiel-Log.csv", makeSampleCsv())}
            data-testid="dyno-sample"
          >
            Beispiel
          </Button>
        </Group>
        {/* Deliberately one CONSTANT sentence: swapping it once the log list
            arrives would reflow the card. The "nothing verified yet" case is
            carried by the disabled picker and its placeholder instead. */}
        <Text size="xs" c="dimmed" mt="sm">
          Nur verifizierte WOT-Pulls stehen zur Auswahl – andere Logs verfälschen die
          Leistungsschätzung. Einen sauberen Pull zuerst im Analyzer prüfen.
        </Text>
        <Text size="xs" c="dimmed" mt={4}>
          Profil: {summarizeDynoProfile(effectiveProfile)} · Motor {spec.engineCode} aus dem
          Fahrzeugprofil
        </Text>
      </Card>

      {active && estimate && (
        <>
          <Card withBorder radius="md" p="md">
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
              <Control label="Methode">
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={method}
                  onChange={(v) => setMethod(v as MethodPreference)}
                  data={METHOD_OPTIONS}
                  data-testid="dyno-method"
                />
              </Control>
              <Control label="Korrektur">
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={correction}
                  onChange={(v) => setCorrection(v as CorrectionStandard)}
                  data={CORRECTION_OPTIONS}
                  data-testid="dyno-correction"
                />
              </Control>
              <Control label="Bezug">
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={output}
                  onChange={(v) => setOutput(v as DynoOutput)}
                  data={OUTPUT_OPTIONS}
                  data-testid="dyno-output"
                />
              </Control>
            </SimpleGrid>
          </Card>

          {curve ? (
            <>
              <Card withBorder radius="md" p="lg" data-testid="dyno-peaks">
                <Group justify="space-between" mb="md" wrap="wrap">
                  <Title order={5}>Spitzenwerte · {OUTPUT_LABELS[output]}</Title>
                  <Group gap="xs">
                    <Badge variant="light" color="orange">
                      {METHOD_LABELS[curve.method]}
                    </Badge>
                    <Badge variant="light" color="slate">
                      {CORRECTION_LABELS[correction]}
                      {correction !== "none" ? ` · ×${curve.correctionFactor.toFixed(3)}` : ""}
                    </Badge>
                  </Group>
                </Group>
                <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
                  <Peak label="Max. Leistung" point={curve.peakPower} output={output} kind="power" />
                  <Peak label="Max. Drehmoment" point={curve.peakTorque} output={output} kind="torque" />
                  <Metric
                    label="Leistung"
                    value={curve.peakPower ? `${fmt(powerOf(curve.peakPower, output).kw, 1)} kW` : "—"}
                    hint="bei Nennleistung"
                  />
                  <Metric
                    label="Umgebung"
                    value={`${fmt(curve.ambient.pressureHpa)} hPa · ${fmt(curve.ambient.tempC, 1)} °C`}
                    hint={curve.ambient.pressureFromLog ? "aus dem Log" : "Normbedingungen"}
                  />
                </SimpleGrid>
                <Text size="xs" c="dimmed" mt="md">
                  Datenbasis: {curve.source}
                </Text>
              </Card>

              {/* Result cards carry p="lg", pickers and control strips p="md" —
                  the same rhythm the comparison page uses. */}
              <Card withBorder radius="md" p="lg">
                <Group justify="space-between" mb="sm" wrap="wrap">
                  <Title order={5}>Leistungs- &amp; Drehmomentkurve</Title>
                  <Group gap="lg">
                    <LegendItem color={SERIES_COLORS.primary} style="solid" label="Leistung (PS)" />
                    <LegendItem color={SERIES_COLORS.secondary} style="dashed" label="Drehmoment (Nm)" />
                    {estimate.crossCheck && (
                      <LegendItem
                        color={SERIES_COLORS.reference}
                        style="dotted"
                        label={`Gegenprobe: ${METHOD_LABELS[estimate.crossCheck.method]}`}
                      />
                    )}
                  </Group>
                </Group>
                <DynoChart
                  rows={rows}
                  curve={curve}
                  output={output}
                  crossCheckLabel={estimate.crossCheck ? METHOD_LABELS[estimate.crossCheck.method] : null}
                />
                {estimate.crossCheck?.peakPower && curve.peakPower && (
                  <Text size="xs" c="dimmed" mt="sm">
                    Gegenprobe ({METHOD_LABELS[estimate.crossCheck.method]}):{" "}
                    {fmt(powerOf(estimate.crossCheck.peakPower, output).ps)} PS bei{" "}
                    {fmt(estimate.crossCheck.peakPower.rpm)} 1/min – Abweichung{" "}
                    {fmt(
                      (powerOf(estimate.crossCheck.peakPower, output).ps / powerOf(curve.peakPower, output).ps - 1) *
                        100,
                      1,
                    )}{" "}
                    %.
                  </Text>
                )}
              </Card>
            </>
          ) : (
            <Alert color="yellow" variant="light" icon={<IconAlertCircle size={16} />} data-testid="dyno-empty">
              Aus diesem Log lässt sich keine Leistungskurve schätzen.
            </Alert>
          )}

          {estimate.notes.length > 0 && (
            <Card withBorder radius="md" p="md" data-testid="dyno-notes">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs">
                Hinweise zur Schätzung
              </Text>
              <Stack gap={6}>
                {estimate.notes.map((n) => (
                  <Group key={n} gap={8} wrap="nowrap" align="flex-start">
                    <IconInfoCircle size={15} style={{ marginTop: 2, flex: "none" }} />
                    <Text size="xs" c="dimmed">
                      {n}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Card>
          )}

          <Text size="xs" c="dimmed">
            Alle Werte sind rechnerische Schätzungen aus dem Datenlog – kein Ersatz für einen realen
            Prüfstandslauf. Für Vorher/Nachher-Vergleiche identische Fahrzeug-Parameter, Strecke und
            Gang verwenden.
          </Text>
        </>
      )}

      <DynoProfileDrawer
        opened={drawerOpen}
        profile={effectiveProfile}
        engineCode={spec.engineCode}
        onClose={() => setDrawerOpen(false)}
        onSave={setProfile}
      />

      <ExportModal
        opened={exportOpen}
        onClose={() => setExportOpen(false)}
        target={active ? (active.id ? { logId: active.id } : { name: active.name, csv: active.csv }) : null}
        spec={spec}
        dyno={{ profile: effectiveProfile, output, correction }}
        // The dyno page leads with the power curve; the raw-file block is noise here.
        initialSections={{ fileSummary: false }}
      />
    </Stack>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={6}>
        {label}
      </Text>
      {children}
    </div>
  );
}

function Peak({
  label,
  point,
  output,
  kind,
}: {
  label: string;
  point: DynoPoint | null;
  output: DynoOutput;
  kind: "power" | "torque";
}) {
  if (!point) return <Metric label={label} value="—" hint="" />;
  const v = powerOf(point, output);
  return (
    <Metric
      label={label}
      value={kind === "power" ? `${fmt(v.ps)} PS` : `${fmt(v.nm)} Nm`}
      hint={`bei ${fmt(point.rpm)} 1/min`}
    />
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} lh={1.3}>
        {label}
      </Text>
      <Text size="xl" fw={700} lh={1.2}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </div>
  );
}

