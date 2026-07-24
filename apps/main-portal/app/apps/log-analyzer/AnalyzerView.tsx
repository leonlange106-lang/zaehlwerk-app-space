"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  FileButton,
  Grid,
  GridCol,
  Group,
  RangeSlider,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCrop,
  IconFileExport,
  IconFileText,
  IconGauge,
  IconRefresh,
  IconSparkles,
  IconUpload,
  IconX,
  IconZoomReset,
} from "@tabler/icons-react";
import { parseLog } from "./lib/log-parser";
import { makeSampleCsv } from "./lib/sample-log";
import { defaultSelection } from "./lib/selection";
import { setActiveLogId, takeActiveLogId } from "./lib/log-store";
import { fetchLog, uploadLogs, type LogRecordDTO } from "./lib/log-api";
import { evaluateLogPull } from "./lib/evaluate-log-pull";
import { loadVehicleSpec } from "./lib/spec-store";
import { DEFAULT_VEHICLE_SPEC, type VehicleSpec } from "./lib/vehicle-spec";
import { loadDynoProfile } from "./lib/dyno-store";
import { DEFAULT_DYNO_PROFILE, type DynoProfile } from "./lib/dyno-spec";
import type { ParsedLog } from "./lib/types";
import { LogCharts } from "./LogCharts";
import { MetadataCard } from "./MetadataCard";
import { EvaluationCard } from "./EvaluationCard";
import { ExportModal } from "./ExportModal";
import { ParameterPanel } from "./ParameterPanel";
import type { AxisSide } from "./lib/types";
import classes from "./LogAnalyzer.module.css";

// The analyzer workspace: drop/pick one or many CSVs (bulk upload) — logs are
// persisted server-side — or pick up a log handed over from Remote Import /
// Overview, then explore it via grouped, synchronized charts with per-channel
// toggles and a time-window zoom.

interface ActiveLog {
  id: string;
  name: string;
  source: string;
  sourceUrl: string | null;
  log: ParsedLog;
}

export function AnalyzerView() {
  const router = useRouter();
  const [active, setActive] = useState<ActiveLog | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [spec, setSpec] = useState<VehicleSpec>(DEFAULT_VEHICLE_SPEC);
  const [dynoProfile, setDynoProfile] = useState<DynoProfile>(DEFAULT_DYNO_PROFILE);
  const [exportOpen, setExportOpen] = useState(false);
  // Per-channel display overrides: which Y axis (left/right) and line colour.
  const [axisById, setAxisById] = useState<Record<string, AxisSide>>({});
  const [colorById, setColorById] = useState<Record<string, string>>({});

  // The vehicle/hardware profile lives in localStorage (client-only). Read it on
  // mount so the evaluation is judged against the user's actual setup.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpec(loadVehicleSpec());
    // The dyno profile is only needed for the optional power section of an
    // exported report, but it lives in the same client-only storage.
    setDynoProfile(loadDynoProfile());
  }, []);

  // Open a stored log record: re-parse its CSV and set it active.
  const openRecord = useCallback((record: LogRecordDTO) => {
    let log: ParsedLog;
    try {
      log = parseLog(record.csv);
    } catch {
      setError("Das gespeicherte Log konnte nicht gelesen werden.");
      return;
    }
    setError(null);
    setActive({
      id: record.id,
      name: record.name,
      source: record.source,
      sourceUrl: record.sourceUrl,
      log,
    });
    setSelected(new Set(defaultSelection(log.series)));
    setRange([0, Math.max(0, log.time.length - 1)]);
    // A fresh log starts with default axis/colour assignments.
    setAxisById({});
    setColorById({});
  }, []);

  const openById = useCallback(
    async (id: string) => {
      try {
        const record = await fetchLog(id);
        if (record) openRecord(record);
        else setError("Log nicht gefunden.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Log konnte nicht geladen werden.");
      }
    },
    [openRecord],
  );

  // Pick up a log handed over from Remote Import or the Overview (one-shot).
  useEffect(() => {
    const handedId = takeActiveLogId();
    // openById only setState()s after an async fetch, never synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (handedId) void openById(handedId);
  }, [openById]);

  // Bulk upload: persist every picked/dropped CSV server-side, then open the
  // first. A single file behaves exactly as before; several are all stored.
  const ingestFiles = useCallback(
    async (files: File[]) => {
      const valid = files.filter((f) => /\.csv$|\.log$|\.txt$/i.test(f.name));
      if (valid.length === 0) {
        setError("Bitte mindestens eine .csv-Datei auswählen.");
        return;
      }
      setError(null);
      setNotice(null);
      setUploading(true);
      try {
        const payload = await Promise.all(
          valid.map(async (f) => ({ name: f.name, csv: await f.text(), source: "upload" as const })),
        );
        const created = await uploadLogs(payload);
        if (created.length === 0) {
          setError("Keine der Dateien enthielt auswertbare Daten.");
          return;
        }
        if (created.length > 1) {
          setNotice(`${created.length} Logs gespeichert. Erstes geöffnet – Rest in der Übersicht.`);
        }
        await openById(created[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload fehlgeschlagen.");
      } finally {
        setUploading(false);
      }
    },
    [openById],
  );

  const handleFiles = useCallback(
    (payload: File | File[] | null) => {
      if (!payload) return;
      void ingestFiles(Array.isArray(payload) ? payload : [payload]);
    },
    [ingestFiles],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) void ingestFiles(files);
    },
    [ingestFiles],
  );

  const loadSample = useCallback(() => {
    setUploading(true);
    setNotice(null);
    void (async () => {
      try {
        const created = await uploadLogs([{ name: "Beispiel-Log.csv", csv: makeSampleCsv() }]);
        if (created[0]) await openById(created[0].id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Beispiel konnte nicht geladen werden.");
      } finally {
        setUploading(false);
      }
    })();
  }, [openById]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((keys: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);

  const setAxis = useCallback((key: string, side: AxisSide) => {
    setAxisById((prev) => ({ ...prev, [key]: side }));
  }, []);

  const setColor = useCallback((key: string, color: string) => {
    setColorById((prev) => ({ ...prev, [key]: color }));
  }, []);

  // Automated pull rating / safety / parameter-completeness evaluation. Pure and
  // cheap; recomputed only when the log or the vehicle profile changes.
  const evaluation = useMemo(
    () => (active ? evaluateLogPull(active.log, spec) : null),
    [active, spec],
  );

  // Crop the visible window to the detected pull, focusing on the WOT sweep.
  const cropToPull = useCallback(() => {
    if (evaluation) setRange([evaluation.window[0], evaluation.window[1]]);
  }, [evaluation]);

  if (!active) {
    return (
      <Stack gap="lg" maw={720} mx="auto">
        <Header />
        {error && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} onClose={() => setError(null)} withCloseButton>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert color="teal" variant="light" onClose={() => setNotice(null)} withCloseButton>
            {notice}
          </Alert>
        )}
        <div
          className={`${classes.dropzone} ${dragging ? classes.dropzoneActive : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-testid="dropzone"
        >
          <Stack gap="sm" align="center">
            <IconUpload size={40} stroke={1.3} color="var(--mantine-color-orange-6)" />
            <div>
              <Text fw={600}>CSV-Logfiles hierher ziehen</Text>
              <Text size="sm" c="dimmed">
                Mehrere Dateien auf einmal möglich – Logs werden serverseitig gespeichert.
              </Text>
            </div>
            <Group gap="sm" mt="xs">
              <FileButton onChange={handleFiles} accept=".csv,.log,.txt,text/csv,text/plain" multiple>
                {(props) => (
                  <Button {...props} color="orange" leftSection={<IconFileText size={16} />} loading={uploading}>
                    Dateien auswählen
                  </Button>
                )}
              </FileButton>
              <Button variant="light" color="slate" leftSection={<IconSparkles size={16} />} onClick={loadSample} disabled={uploading}>
                Beispiel laden
              </Button>
            </Group>
          </Stack>
        </div>
      </Stack>
    );
  }

  const { log } = active;
  const windowLabel =
    log.timeUnit === "s"
      ? `${log.time[range[0]]?.toFixed(1)}s – ${log.time[range[1]]?.toFixed(1)}s`
      : `#${range[0]} – #${range[1]}`;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Group gap="sm">
            <Title order={3}>{active.name}</Title>
            <Badge variant="light" color={active.source === "remote" ? "blue" : "orange"}>
              {active.source === "remote" ? "Remote-Import" : "Upload"}
            </Badge>
          </Group>
          {active.sourceUrl && (
            <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>
              {active.sourceUrl}
            </Text>
          )}
        </div>
        <Group gap="xs">
          <Button
            variant="light"
            color="teal"
            size="xs"
            leftSection={<IconFileExport size={14} />}
            onClick={() => setExportOpen(true)}
            data-testid="open-export"
          >
            Exportieren / Bericht erstellen
          </Button>
          <Button
            variant="light"
            color="orange"
            size="xs"
            leftSection={<IconGauge size={14} />}
            onClick={() => {
              // Hand the open log over to the dyno page (one-shot, by id).
              setActiveLogId(active.id);
              router.push("/apps/log-analyzer/dyno");
            }}
            data-testid="open-dyno"
          >
            Virtueller Prüfstand
          </Button>
          <FileButton onChange={handleFiles} accept=".csv,.log,.txt,text/csv,text/plain" multiple>
            {(props) => (
              <Button {...props} variant="light" color="slate" size="xs" leftSection={<IconRefresh size={14} />} loading={uploading}>
                Logs hochladen
              </Button>
            )}
          </FileButton>
          <Button
            variant="subtle"
            color="slate"
            size="xs"
            leftSection={<IconX size={14} />}
            onClick={() => {
              setActive(null);
              setSelected(new Set());
              setError(null);
            }}
          >
            Schließen
          </Button>
        </Group>
      </Group>

      <MetadataCard meta={log.meta} rowCount={log.rowCount} skippedRows={log.skippedRows} />

      {evaluation && <EvaluationCard evaluation={evaluation} spec={spec} />}

      <Card withBorder radius="md" p="md">
        <Group justify="space-between" mb="xs">
          <Text size="sm" fw={600}>
            Zeitfenster
          </Text>
          <Group gap="sm">
            <Text size="xs" c="dimmed">
              {windowLabel}
            </Text>
            {evaluation && evaluation.window[1] > evaluation.window[0] && (
              <Button
                variant="light"
                size="compact-xs"
                color="teal"
                leftSection={<IconCrop size={13} />}
                onClick={cropToPull}
                data-testid="crop-to-pull"
              >
                Auf Pull zuschneiden
              </Button>
            )}
            <Button
              variant="subtle"
              size="compact-xs"
              color="slate"
              leftSection={<IconZoomReset size={13} />}
              onClick={() => setRange([0, Math.max(0, log.time.length - 1)])}
            >
              Zoom zurücksetzen
            </Button>
          </Group>
        </Group>
        <RangeSlider
          min={0}
          max={Math.max(0, log.time.length - 1)}
          value={range}
          onChange={setRange}
          color="orange"
          minRange={1}
          label={(v) => (log.timeUnit === "s" ? `${log.time[v]?.toFixed(1)}s` : `#${v}`)}
          aria-label="Zeitfenster wählen"
        />
      </Card>

      <Grid gutter="lg">
        <GridCol span={{ base: 12, md: 3 }}>
          <ParameterPanel
            series={log.series}
            selected={selected}
            axisById={axisById}
            colorById={colorById}
            onToggle={toggle}
            onToggleGroup={toggleGroup}
            onAxis={setAxis}
            onColor={setColor}
          />
        </GridCol>
        <GridCol span={{ base: 12, md: 9 }}>
          <LogCharts
            key={active.id}
            log={log}
            selectedKeys={[...selected]}
            range={range}
            axisById={axisById}
            colorById={colorById}
            pullRange={evaluation?.pullRange ?? null}
            pullVerified={evaluation?.validity.status === "verified"}
            violations={evaluation?.violations ?? []}
            exclusionRanges={evaluation?.exclusionRanges ?? []}
          />
        </GridCol>
      </Grid>

      <ExportModal
        opened={exportOpen}
        onClose={() => setExportOpen(false)}
        target={{ logId: active.id }}
        spec={spec}
        dyno={{ profile: dynoProfile, output: "crank", correction: "none" }}
      />
    </Stack>
  );
}

function Header() {
  return (
    <Group gap="md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-log-analyzer.svg" alt="" width={48} height={48} />
      <div>
        <Title order={2}>MGflasher Log Analyzer</Title>
        <Text c="dimmed" size="sm">
          ECU/TCU-Datenlogs importieren, visualisieren und analysieren.
        </Text>
      </div>
    </Group>
  );
}
