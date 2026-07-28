"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/app/components/ui/Badge";
import { Button } from "@/app/components/ui/Button";
import { Select, SelectShell } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { Skeleton } from "@/app/components/ui/Skeleton";
import {
  Alert,
  FilePicker,
  IconChip,
  PageHeader,
  SegmentedControl,
} from "@/app/components/ui/primitives";
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
import { getActiveVehicleAction } from "@/app/lib/vehicle-actions";
import { loadDynoProfile } from "./lib/dyno-store";
import { DEFAULT_VEHICLE_SPEC, type VehicleSpec } from "./lib/vehicle-spec";
import type { ParsedLog } from "./lib/types";
import { DynoChartSkeleton } from "./ChartSkeletons";

// The plot (Recharts), the profile drawer and the export dialog are all reached
// only after the user picks a log or opens an overlay, so none of them belong in
// the chunk that renders this page.
const DynoChart = lazy(() => import("./DynoChart").then((m) => ({ default: m.DynoChart })));
const DynoProfileDrawer = lazy(() =>
  import("./DynoProfileDrawer").then((m) => ({ default: m.DynoProfileDrawer })),
);
const ExportModal = lazy(() => import("./ExportModal").then((m) => ({ default: m.ExportModal })));
import { LegendItem, SERIES_COLORS } from "./ChartLegend";
import { MetricTile } from "@/app/components/ui/MetricTile";
import { CONTROL_SKELETON_CLASS } from "./ui-metrics";

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
  // Whether the profile below is the user's own, derived from their platform, or
  // placeholder numbers — the summary line has to be honest about which.
  const [profileOrigin, setProfileOrigin] = useState<"saved" | "preset" | "generic">("generic");

  // Spec and dynamics profile come from the maintained vehicle on the SERVER.
  // They used to be read from localStorage — a store nothing has written since
  // the vehicle form moved to the database, so the dyno estimated against the
  // module default no matter which car was maintained.
  //
  // Spec first, as before: with no saved profile the dyno derives from the
  // user's own car rather than from whichever platform is the module default.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const vehicle = await getActiveVehicleAction();
        if (cancelled || !vehicle) return;
        setSpec(vehicle.spec);
        if (vehicle.dynoProfile) {
          setProfile(vehicle.dynoProfile);
          setProfileOrigin("saved");
        } else {
          const derived = loadDynoProfile(vehicle.spec);
          setProfile(derived.profile);
          setProfileOrigin(derived.origin);
        }
      } catch {
        // A failed lookup must not take the dyno down — the defaults stand.
      }
    })();
    return () => {
      cancelled = true;
    };
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
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <IconChip size={44}>
          <IconGauge size={22} stroke={1.6} />
        </IconChip>
        <PageHeader
          title="Virtueller Prüfstand"
          description="Leistung und Drehmoment aus dem WOT-Pull schätzen – Luftmasse und Fahrdynamik."
          action={
            <>
              {/* Always mounted, disabled until a log is open: a log handed over
                  from the Analyzer arrives asynchronously, and a button appearing
                  at that moment would push the header around on narrow screens. */}
              <Button
                variant="subtle"
                onClick={() => setExportOpen(true)}
                disabled={!active}
                data-testid="open-export"
              >
                <IconFileExport size={16} />
                <span className="hidden sm:inline">Exportieren / Bericht erstellen</span>
                <span className="sm:hidden">Bericht</span>
              </Button>
              <Button onClick={() => setDrawerOpen(true)} data-testid="dyno-open-profile">
                <IconAdjustments size={16} />
                <span className="hidden sm:inline">Fahrzeug-Parameter</span>
                <span className="sm:hidden">Parameter</span>
              </Button>
            </>
          }
        />
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

      <Panel className="[&]:p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="truncate text-sm font-semibold">{active ? active.name : "Log wählen"}</p>
          {active && (
            <Badge tone="accent" data-testid="dyno-log-badge">
              {active.log.rowCount.toLocaleString("de-DE")} Zeilen
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Reserved either way: a Select that only mounts once the stored-log
              list arrives reflows the whole row (and eats clicks) mid-load. */}
          {historyLoading ? (
            <Skeleton
              className={`${CONTROL_SKELETON_CLASS} sm:w-72`}
              data-testid="dyno-history-skeleton"
            />
          ) : (
            <SelectShell className="sm:w-72">
              <Select
                aria-label="Verifizierten Pull wählen"
                defaultValue=""
                disabled={verifiedHistory.length === 0}
                onChange={(event) => {
                  const id = event.currentTarget.value;
                  if (id) void openById(id);
                }}
                data-testid="dyno-history"
              >
                <option value="">
                  {verifiedHistory.length > 0
                    ? "Verifizierten Pull wählen…"
                    : "Keine verifizierten Pulls"}
                </option>
                {verifiedHistory.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </SelectShell>
          )}
          <div className="flex flex-wrap gap-2">
            <FilePicker
              accept=".csv,.log,.txt,text/csv,text/plain"
              className="min-h-11 px-3 text-[13px] sm:min-h-10"
              onChange={(event) => void handleFile(event.currentTarget.files?.[0] ?? null)}
            >
              <IconFileText size={14} />
              Datei
            </FilePicker>
            <Button
              variant="ghost"
              onClick={() => ingest("Beispiel-Log.csv", makeSampleCsv())}
              data-testid="dyno-sample"
            >
              <IconSparkles size={14} />
              Beispiel
            </Button>
          </div>
        </div>
        {/* Deliberately one CONSTANT sentence: swapping it once the log list
            arrives would reflow the card. The "nothing verified yet" case is
            carried by the disabled picker and its placeholder instead. */}
        <p className="mt-3 text-xs text-dim">
          Nur verifizierte WOT-Pulls stehen zur Auswahl – andere Logs verfälschen die
          Leistungsschätzung. Einen sauberen Pull zuerst im Analyzer prüfen.
        </p>
        <p className="mt-1 text-xs text-dim">
          Profil: {summarizeDynoProfile(effectiveProfile)} · Motor {spec.engineCode} aus dem
          Fahrzeugprofil
        </p>
        {/* Says where the numbers came from. A power estimate built on another
            car's mass and gear set looks exactly as confident as a correct one,
            so the difference has to be on screen — not only in the drawer. */}
        {profileOrigin === "generic" && (
          <p className="mt-1 text-xs text-watch">
            Für dieses Modell gibt es noch kein Referenz-Profil – Masse, Reifen, Übersetzung
            und Luftwiderstand sind Platzhalter. Unter „Fahrzeug-Parameter“ anpassen, sonst
            beschreibt die Schätzung nicht dein Auto.
          </p>
        )}
        {profileOrigin === "preset" && (
          <p className="mt-1 text-xs text-dim">
            Aus deinem Fahrzeug-Profil abgeleitet. Änderungen unter „Fahrzeug-Parameter“
            überschreiben das dauerhaft.
          </p>
        )}
      </Panel>

      {active && estimate && (
        <>
          <Panel className="[&]:p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Control label="Methode">
                <SegmentedControl
                  label="Methode"
                  value={method}
                  onChange={setMethod}
                  options={METHOD_OPTIONS}
                  data-testid="dyno-method"
                />
              </Control>
              <Control label="Korrektur">
                <SegmentedControl
                  label="Korrektur"
                  value={correction}
                  onChange={setCorrection}
                  options={CORRECTION_OPTIONS}
                  data-testid="dyno-correction"
                />
              </Control>
              <Control label="Bezug">
                <SegmentedControl
                  label="Bezug"
                  value={output}
                  onChange={setOutput}
                  options={OUTPUT_OPTIONS}
                  data-testid="dyno-output"
                />
              </Control>
            </div>
          </Panel>

          {curve ? (
            <>
              <Panel
                title={`Spitzenwerte · ${OUTPUT_LABELS[output]}`}
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{METHOD_LABELS[curve.method]}</Badge>
                    <Badge>
                      {CORRECTION_LABELS[correction]}
                      {correction !== "none" ? ` · ×${curve.correctionFactor.toFixed(3)}` : ""}
                    </Badge>
                  </div>
                }
                data-testid="dyno-peaks"
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Peak label="Max. Leistung" point={curve.peakPower} output={output} kind="power" />
                  <Peak
                    label="Max. Drehmoment"
                    point={curve.peakTorque}
                    output={output}
                    kind="torque"
                  />
                  <Metric
                    label="Leistung"
                    value={
                      curve.peakPower ? `${fmt(powerOf(curve.peakPower, output).kw, 1)} kW` : "—"
                    }
                    hint="bei Nennleistung"
                  />
                  <Metric
                    label="Umgebung"
                    value={`${fmt(curve.ambient.pressureHpa)} hPa · ${fmt(curve.ambient.tempC, 1)} °C`}
                    hint={curve.ambient.pressureFromLog ? "aus dem Log" : "Normbedingungen"}
                  />
                </div>
                <p className="mt-4 text-xs text-dim">Datenbasis: {curve.source}</p>
              </Panel>

              <Panel
                title="Leistungs- &amp; Drehmomentkurve"
                action={
                  <div className="flex flex-wrap items-center gap-4">
                    <LegendItem color={SERIES_COLORS.primary} style="solid" label="Leistung (PS)" />
                    <LegendItem
                      color={SERIES_COLORS.secondary}
                      style="dashed"
                      label="Drehmoment (Nm)"
                    />
                    {estimate.crossCheck && (
                      <LegendItem
                        color={SERIES_COLORS.reference}
                        style="dotted"
                        label={`Gegenprobe: ${METHOD_LABELS[estimate.crossCheck.method]}`}
                      />
                    )}
                  </div>
                }
              >
                <Suspense fallback={<DynoChartSkeleton />}>
                  <DynoChart
                    rows={rows}
                    curve={curve}
                    output={output}
                    crossCheckLabel={
                      estimate.crossCheck ? METHOD_LABELS[estimate.crossCheck.method] : null
                    }
                  />
                </Suspense>
                {estimate.crossCheck?.peakPower && curve.peakPower && (
                  <p className="mt-3 text-xs text-dim">
                    Gegenprobe ({METHOD_LABELS[estimate.crossCheck.method]}):{" "}
                    {fmt(powerOf(estimate.crossCheck.peakPower, output).ps)} PS bei{" "}
                    {fmt(estimate.crossCheck.peakPower.rpm)} 1/min – Abweichung{" "}
                    {fmt(
                      (powerOf(estimate.crossCheck.peakPower, output).ps /
                        powerOf(curve.peakPower, output).ps -
                        1) *
                        100,
                      1,
                    )}{" "}
                    %.
                  </p>
                )}
              </Panel>
            </>
          ) : (
            <Alert tone="watch" icon={<IconAlertCircle size={16} />} data-testid="dyno-empty">
              Aus diesem Log lässt sich keine Leistungskurve schätzen.
            </Alert>
          )}

          {estimate.notes.length > 0 && (
            <Panel className="[&]:p-4" data-testid="dyno-notes">
              <p className="legend-label mb-2">Hinweise zur Schätzung</p>
              <ul className="flex flex-col gap-1.5">
                {estimate.notes.map((n) => (
                  <li key={n} className="flex items-start gap-2">
                    <IconInfoCircle size={15} className="mt-px flex-none text-dim" />
                    <span className="text-xs text-dim">{n}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <p className="text-xs text-dim">
            Alle Werte sind rechnerische Schätzungen aus dem Datenlog – kein Ersatz für einen realen
            Prüfstandslauf. Für Vorher/Nachher-Vergleiche identische Fahrzeug-Parameter, Strecke und
            Gang verwenden.
          </p>
        </>
      )}

      {/* Both are overlays: closed they render nothing, so there is no geometry
          to reserve and mounting them on demand cannot shift the page. */}
      {drawerOpen && (
        <Suspense fallback={null}>
          <DynoProfileDrawer
            opened
            profile={effectiveProfile}
            engineCode={spec.engineCode}
            onClose={() => setDrawerOpen(false)}
            onSave={(next) => {
              setProfile(next);
              // Once saved it is the user's own profile, so the "placeholder
              // values" warning above must stop claiming otherwise.
              setProfileOrigin("saved");
            }}
          />
        </Suspense>
      )}

      {exportOpen && (
        <Suspense fallback={null}>
          <ExportModal
            opened
            onClose={() => setExportOpen(false)}
            target={active ? (active.id ? { logId: active.id } : { name: active.name, csv: active.csv }) : null}
            spec={spec}
            dyno={{ profile: effectiveProfile, output, correction }}
            // The dyno page leads with the power curve; the raw-file block is noise here.
            initialSections={{ fileSummary: false }}
          />
        </Suspense>
      )}
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="legend-label mb-1.5">{label}</p>
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

/**
 * The dyno's own figures render as the shared KPI plate, so a peak-power number
 * here looks and measures exactly like one on the Zählwerk dashboard.
 */
function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <MetricTile label={label} value={value} hint={hint || undefined} />;
}

