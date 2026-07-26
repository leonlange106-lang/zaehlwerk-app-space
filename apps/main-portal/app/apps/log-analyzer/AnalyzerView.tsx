"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/app/components/ui/Badge";
import { Button } from "@/app/components/ui/Button";
import { Panel } from "@/app/components/ui/Panel";
import { RangeSlider } from "@/app/components/ui/RangeSlider";
import { Alert, FilePicker, IconChip, PageHeader } from "@/app/components/ui/primitives";
import {
  IconAlertCircle,
  IconCheck,
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
import { groupSelectedSeries } from "./lib/chart-data";
import { ChartStackSkeleton } from "./ChartSkeletons";
import { MetadataCard } from "./MetadataCard";
import { EvaluationCard } from "./EvaluationCard";
import { ParameterPanel, ParameterPanelBody } from "./ParameterPanel";
import { ChannelChips } from "./ChannelChips";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import type { AxisSide } from "./lib/types";
import classes from "./LogAnalyzer.module.css";

// Recharts and the report/PDF plumbing are the two heaviest things this page can
// pull in, and neither is needed to render it: the charts only matter once a log
// is open, and the export dialog only once it is opened. Splitting them out
// keeps the initial analyzer bundle to the shell the user actually sees first.
const LogCharts = lazy(() => import("./LogCharts").then((m) => ({ default: m.LogCharts })));
const ExportModal = lazy(() => import("./ExportModal").then((m) => ({ default: m.ExportModal })));

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
  // Phones reach the full parameter panel through a bottom sheet; the chip bar
  // above the charts covers the common "drop this trace" case without it.
  const [channelSheetOpen, setChannelSheetOpen] = useState(false);
  // Per-channel display overrides: which Y axis (left/right) and line colour.
  const [axisById, setAxisById] = useState<Record<string, AxisSide>>({});
  const [colorById, setColorById] = useState<Record<string, string>>({});

  // The vehicle/hardware profile lives in localStorage (client-only). Read it on
  // mount so the evaluation is judged against the user's actual setup.
  useEffect(() => {
    const loaded = loadVehicleSpec();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpec(loaded);
    // The dyno profile is only needed for the optional power section of an
    // exported report, but it lives in the same client-only storage — and it is
    // derived from the vehicle when the user has not saved one of their own.
    setDynoProfile(loadDynoProfile(loaded).profile);
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

  // Open the log this view was navigated to, from either of two routes in.
  //
  //   ?log=<id>  — a real link. The navigation menu uses it, so a log entry
  //                behaves like a link should: middle-click, "open in new tab",
  //                bookmark and the back button all work, and a reload lands on
  //                the same log. That is why the URL WINS and is not consumed.
  //   sessionStorage — the one-shot handover from Remote Import and from
  //                Analyzer → Prüfstand, where there is no id in the URL to use.
  //
  // The handover is taken unconditionally so a stale pending id can't sit there
  // and hijack a later visit; the URL simply outranks it.
  //
  // Read from `window.location` rather than `useSearchParams()`: this page is
  // not force-dynamic, and that hook would need a Suspense boundary around the
  // whole view to keep the build prerenderable. A one-shot read on mount is what
  // this is, and it has neither requirement.
  useEffect(() => {
    const handedId = takeActiveLogId();
    const fromUrl = new URLSearchParams(window.location.search).get("log")?.trim();
    const id = fromUrl || handedId;
    // openById only setState()s after an async fetch, never synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id) void openById(id);
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

  // How many chart panels the stack will render — needed up front so the
  // loading placeholder can reserve their height while the chunk downloads.
  const chartGroupCount = useMemo(
    () => (active ? groupSelectedSeries(active.log.series, [...selected]).length : 0),
    [active, selected],
  );

  // Crop the visible window to the detected pull, focusing on the WOT sweep.
  const cropToPull = useCallback(() => {
    if (evaluation) setRange([evaluation.window[0], evaluation.window[1]]);
  }, [evaluation]);

  if (!active) {
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
        <Header />
        {error && (
          <Alert
            tone="risk"
            role="alert"
            icon={<IconAlertCircle size={16} />}
            onDismiss={() => setError(null)}
          >
            {error}
          </Alert>
        )}
        {notice && (
          <Alert tone="ok" icon={<IconCheck size={16} />} onDismiss={() => setNotice(null)}>
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
          <div className="flex flex-col items-center gap-3 py-4">
            <IconChip size={56} className="rounded-panel">
              <IconUpload size={26} stroke={1.4} />
            </IconChip>
            <div>
              <p className="font-semibold">CSV-Logfiles hierher ziehen</p>
              <p className="mt-0.5 text-sm text-dim">
                Mehrere Dateien auf einmal möglich – Logs werden serverseitig gespeichert.
              </p>
            </div>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <FilePicker
                accept=".csv,.log,.txt,text/csv,text/plain"
                multiple
                disabled={uploading}
                className="accent-gradient border-transparent text-white"
                onChange={(event) => handleFiles([...(event.currentTarget.files ?? [])])}
              >
                <IconFileText size={16} />
                {uploading ? "Wird hochgeladen…" : "Dateien auswählen"}
              </FilePicker>
              <Button variant="subtle" onClick={loadSample} disabled={uploading}>
                <IconSparkles size={16} />
                Beispiel laden
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const { log } = active;
  const windowLabel =
    log.timeUnit === "s"
      ? `${log.time[range[0]]?.toFixed(1)}s – ${log.time[range[1]]?.toFixed(1)}s`
      : `#${range[0]} – #${range[1]}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{active.name}</h1>
            <Badge tone="accent">
              {active.source === "remote" ? "Remote-Import" : "Upload"}
            </Badge>
          </div>
          {active.sourceUrl && (
            <p className="mt-1 text-xs break-all text-dim">{active.sourceUrl}</p>
          )}
        </div>
        {/* One wrapping row of compact actions rather than four full-width
            stacked buttons — at 390px the old layout pushed the metadata and the
            verdict a whole screen down before anything useful was visible. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="subtle" size="sm" onClick={() => setExportOpen(true)} data-testid="open-export">
            <IconFileExport size={14} />
            Bericht
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              // Hand the open log over to the dyno page (one-shot, by id).
              setActiveLogId(active.id);
              router.push("/apps/log-analyzer/dyno");
            }}
            data-testid="open-dyno"
          >
            <IconGauge size={14} />
            Prüfstand
          </Button>
          <FilePicker
            accept=".csv,.log,.txt,text/csv,text/plain"
            multiple
            disabled={uploading}
            className="min-h-9 px-3 text-[13px] sm:min-h-9"
            onChange={(event) => handleFiles([...(event.currentTarget.files ?? [])])}
          >
            <IconRefresh size={14} />
            {uploading ? "Lädt…" : "Hochladen"}
          </FilePicker>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActive(null);
              setSelected(new Set());
              setError(null);
            }}
          >
            <IconX size={14} />
            Schließen
          </Button>
        </div>
      </div>

      {error && (
        <Alert
          tone="risk"
          role="alert"
          icon={<IconAlertCircle size={16} />}
          onDismiss={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      <MetadataCard meta={log.meta} rowCount={log.rowCount} skippedRows={log.skippedRows} />

      {evaluation && <EvaluationCard evaluation={evaluation} spec={spec} />}

      <Panel className="[&]:p-4">
        {/* Title and the window itself on one line, the two actions on the next.
            Letting all four wrap freely put each on its own row at 390px and
            pushed the slider — the thing you came here to drag — most of a
            screen down. */}
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">Zeitfenster</p>
          <span className="readout truncate text-xs">{windowLabel}</span>
        </div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {evaluation && evaluation.window[1] > evaluation.window[0] && (
            <Button variant="subtle" size="sm" onClick={cropToPull} data-testid="crop-to-pull">
              <IconCrop size={13} />
              Auf Pull zuschneiden
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRange([0, Math.max(0, log.time.length - 1)])}
          >
            <IconZoomReset size={13} />
            Zoom zurücksetzen
          </Button>
        </div>
        <RangeSlider
          label="Zeitfenster"
          min={0}
          max={Math.max(0, log.time.length - 1)}
          value={range}
          onChange={setRange}
          minRange={1}
          formatValue={(v) => (log.timeUnit === "s" ? `${log.time[v]?.toFixed(1)} s` : `Zeile ${v}`)}
        />
      </Panel>

      {/* `min-w-0` on the grid AND on the chart column: a grid child defaults to
          `min-width: auto` and would otherwise be sized by the chart's minimum
          content width, widening the page past the viewport on a phone. */}
      <div className="grid min-w-0 gap-4 md:grid-cols-12">
        {/* The parameter sidebar is a tablet/desktop affordance — at 390px it
            would eat the entire viewport before a single chart appeared. The
            switch is a media query, never a hook: `useMediaQuery` resolves after
            mount and would reflow the page in front of the user. */}
        <div className="hidden min-w-0 md:col-span-3 md:block">
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
        </div>
        <div className="min-w-0 md:col-span-9">
          <div className="mb-2 md:hidden">
            <ChannelChips
              series={log.series}
              selected={selected}
              colorById={colorById}
              onToggle={toggle}
              onOpenAll={() => setChannelSheetOpen(true)}
            />
          </div>
          {/* The placeholder is sized from the same grouping the stack uses, so
              the chunk arriving swaps content into a box that is already the
              right height. */}
          <Suspense fallback={<ChartStackSkeleton count={chartGroupCount} />}>
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
          </Suspense>
        </div>
      </div>

      {/* Full channel panel for phones. Mounted only while open, so it costs
          nothing on the desktop path where the sidebar already shows it. */}
      <ResponsiveDialog
        opened={channelSheetOpen}
        onClose={() => setChannelSheetOpen(false)}
        title="Parameter & Kanäle"
        data-testid="channel-sheet"
      >
        <ParameterPanelBody
          series={log.series}
          selected={selected}
          axisById={axisById}
          colorById={colorById}
          onToggle={toggle}
          onToggleGroup={toggleGroup}
          onAxis={setAxis}
          onColor={setColor}
        />
      </ResponsiveDialog>

      {/* A closed dialog renders nothing, so there is no geometry to reserve and
          no fallback to show. */}
      {exportOpen && (
        <Suspense fallback={null}>
          <ExportModal
            opened
            onClose={() => setExportOpen(false)}
            target={{ logId: active.id }}
            spec={spec}
            dyno={{ profile: dynoProfile, output: "crank", correction: "none" }}
          />
        </Suspense>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-log-analyzer.svg" alt="" width={48} height={48} className="flex-none" />
      <PageHeader
        title="Log Analyzer"
        description="ECU/TCU-Datenlogs importieren, visualisieren und analysieren."
      />
    </div>
  );
}
