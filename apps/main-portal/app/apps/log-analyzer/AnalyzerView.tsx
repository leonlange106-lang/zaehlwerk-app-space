"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  IconFileText,
  IconRefresh,
  IconSparkles,
  IconUpload,
  IconX,
  IconZoomReset,
} from "@tabler/icons-react";
import { parseLog } from "./lib/log-parser";
import { makeSampleCsv } from "./lib/sample-log";
import { defaultSelection } from "./lib/selection";
import {
  addToHistory,
  newLogId,
  takeActiveLog,
  type StoredLog,
} from "./lib/log-store";
import { evaluateLogPull } from "./lib/evaluate-log-pull";
import { loadVehicleSpec } from "./lib/spec-store";
import { DEFAULT_VEHICLE_SPEC, type VehicleSpec } from "./lib/vehicle-spec";
import { LogCharts } from "./LogCharts";
import { MetadataCard } from "./MetadataCard";
import { EvaluationCard } from "./EvaluationCard";
import { ParameterPanel } from "./ParameterPanel";
import classes from "./LogAnalyzer.module.css";

// The analyzer workspace: drop/pick a CSV (or pick up a log handed over from
// Remote Import / History), then explore it via grouped, synchronized charts
// with per-channel toggles and a time-window zoom.

export function AnalyzerView() {
  const [active, setActive] = useState<StoredLog | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [spec, setSpec] = useState<VehicleSpec>(DEFAULT_VEHICLE_SPEC);

  // The vehicle/hardware profile lives in localStorage (client-only). Read it on
  // mount so the evaluation is judged against the user's actual setup.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpec(loadVehicleSpec());
  }, []);

  const load = useCallback((entry: StoredLog) => {
    setError(null);
    setActive(entry);
    setSelected(new Set(defaultSelection(entry.log.series)));
    setRange([0, Math.max(0, entry.log.time.length - 1)]);
  }, []);

  // Pick up a log handed over from Remote Import or History (one-shot). This is a
  // mount-time read of sessionStorage, which cannot run during SSR — the effect
  // runs exactly once, so the cascading-render concern does not apply here.
  useEffect(() => {
    const handed = takeActiveLog();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (handed) load(handed);
  }, [load]);

  const ingest = useCallback(
    (name: string, text: string) => {
      try {
        const log = parseLog(text);
        if (log.rowCount === 0) {
          setError("Die Datei enthält keine auswertbaren Datenzeilen.");
          return;
        }
        const entry: StoredLog = {
          id: newLogId(),
          name,
          source: "upload",
          importedAt: Date.now(),
          log,
        };
        addToHistory(entry);
        load(entry);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Die Datei konnte nicht gelesen werden.");
      }
    },
    [load],
  );

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

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const loadSample = useCallback(() => {
    ingest("Beispiel-Log.csv", makeSampleCsv());
  }, [ingest]);

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

  // Automated pull rating / safety / parameter-completeness evaluation. Pure and
  // cheap; recomputed only when the log or the vehicle profile changes.
  const evaluation = useMemo(
    () => (active ? evaluateLogPull(active.log, spec) : null),
    [active, spec],
  );

  if (!active) {
    return (
      <Stack gap="lg" maw={720} mx="auto">
        <Header />
        {error && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} onClose={() => setError(null)} withCloseButton>
            {error}
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
              <Text fw={600}>CSV-Logfile hierher ziehen</Text>
              <Text size="sm" c="dimmed">
                oder eine Datei auswählen – die Auswertung passiert lokal im Browser.
              </Text>
            </div>
            <Group gap="sm" mt="xs">
              <FileButton onChange={handleFile} accept=".csv,.log,.txt,text/csv,text/plain">
                {(props) => (
                  <Button {...props} color="orange" leftSection={<IconFileText size={16} />}>
                    Datei auswählen
                  </Button>
                )}
              </FileButton>
              <Button variant="light" color="slate" leftSection={<IconSparkles size={16} />} onClick={loadSample}>
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
          <FileButton onChange={handleFile} accept=".csv,.log,.txt,text/csv,text/plain">
            {(props) => (
              <Button {...props} variant="light" color="slate" size="xs" leftSection={<IconRefresh size={14} />}>
                Anderes Log
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
          <ParameterPanel series={log.series} selected={selected} onToggle={toggle} onToggleGroup={toggleGroup} />
        </GridCol>
        <GridCol span={{ base: 12, md: 9 }}>
          <LogCharts key={active.id} log={log} selectedKeys={[...selected]} range={range} />
        </GridCol>
      </Grid>
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
