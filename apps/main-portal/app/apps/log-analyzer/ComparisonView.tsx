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
  IconAlertCircle,
  IconArrowsDiff,
  IconFileText,
  IconSparkles,
} from "@tabler/icons-react";
import { parseLog } from "./lib/log-parser";
import { makeSampleCsv } from "./lib/sample-log";
import {
  buildOverlay,
  compareLogs,
  OVERLAY_CHANNELS,
  type MetricDelta,
  type OverlayChannel,
} from "./lib/compare-logs";
import type { AlignMode, OverlayAxis } from "./lib/log-align";
import { fetchLog, fetchLogs, type LogSummaryDTO } from "./lib/log-api";
import type { ParsedLog } from "./lib/types";
import { OverlayChartSkeleton } from "./ChartSkeletons";

// Recharts is only needed once two logs are actually being compared, so it is
// split out of the page shell (which is what the picker cards are).
const OverlayChart = lazy(() =>
  import("./OverlayChart").then((m) => ({ default: m.OverlayChart })),
);
import { LegendItem, SERIES_COLORS } from "./ChartLegend";
import { MetricTile } from "@/app/components/ui/MetricTile";
import { CONTROL_SKELETON_CLASS } from "./ui-metrics";

// Dual-log comparison workspace. Two logs — Baseline (A) and Comparison (B) —
// are loaded (from history or a fresh upload), reduced to key-metric diff cards
// and overlaid on a shared axis: either elapsed time anchored at each log's own
// WOT start, or engine speed for a direct pull-vs-pull overlay. The heavy
// lifting is in compare-logs.ts; this component is orchestration + presentation.

interface Side {
  name: string;
  log: ParsedLog;
}

const CHANNEL_OPTIONS: { value: OverlayChannel; label: string }[] = (
  Object.keys(OVERLAY_CHANNELS) as OverlayChannel[]
).map((value) => ({ value, label: OVERLAY_CHANNELS[value].label }));

const AXIS_OPTIONS: { value: OverlayAxis; label: string }[] = [
  { value: "time", label: "Zeit (s)" },
  { value: "rpm", label: "Drehzahl (rpm)" },
];

const ALIGN_OPTIONS: { value: AlignMode; label: string }[] = [
  { value: "wot", label: "WOT-Start (t=0)" },
  { value: "raw", label: "Roh-Zeitachse" },
];

function fmtNum(v: number | null, unit: string | null): string {
  if (v === null) return "—";
  const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${rounded.toLocaleString("de-DE")}${unit ? ` ${unit}` : ""}`;
}

/** The log-time position a pull was anchored at, for the delta card's subline. */
function fmtAnchor(offset: number): string {
  return `${(Math.round(offset * 10) / 10).toLocaleString("de-DE")} s`;
}

function fmtDelta(m: MetricDelta): { text: string; token: string } {
  if (m.delta === null) return { text: "—", token: "var(--zw-neutral)" };
  const rounded = Math.abs(m.delta) >= 100 ? Math.round(m.delta) : Math.round(m.delta * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  // Neutral colouring: this surfaces DIRECTION, not a value judgement — more
  // boost is not automatically better — so it deliberately avoids the ok/risk
  // tokens, and the sign in the text carries the direction regardless.
  const token =
    rounded === 0
      ? "var(--zw-neutral)"
      : rounded > 0
        ? "var(--zw-series-secondary)"
        : "var(--zw-series-primary)";
  return { text: `${sign}${rounded.toLocaleString("de-DE")}${m.unit ? ` ${m.unit}` : ""}`, token };
}

export function ComparisonView() {
  const [a, setA] = useState<Side | null>(null);
  const [b, setB] = useState<Side | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<OverlayChannel>("boost");
  const [axis, setAxis] = useState<OverlayAxis>("rpm");
  const [align, setAlign] = useState<AlignMode>("wot");
  const [history, setHistory] = useState<LogSummaryDTO[]>([]);
  // The stored-log list arrives after mount. The picker cards reserve its row
  // either way (see LogPicker), so this flag only picks skeleton vs. control —
  // it never changes the card's height.
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const logs = await fetchLogs();
        if (!cancelled) setHistory(logs);
      } catch {
        // non-fatal — the file pickers still work without the stored list
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ingest = useCallback(
    (side: "a" | "b", name: string, text: string) => {
      try {
        const log = parseLog(text);
        if (log.rowCount === 0) {
          setError("Die Datei enthält keine auswertbaren Datenzeilen.");
          return;
        }
        setError(null);
        const entry = { name, log };
        if (side === "a") setA(entry);
        else setB(entry);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Die Datei konnte nicht gelesen werden.");
      }
    },
    [],
  );

  const handleFile = useCallback(
    async (side: "a" | "b", file: File | null) => {
      if (!file) return;
      if (!/\.csv$|\.log$|\.txt$/i.test(file.name)) {
        setError("Bitte eine .csv-Datei auswählen.");
        return;
      }
      ingest(side, file.name, await file.text());
    },
    [ingest],
  );

  const pickHistory = useCallback((side: "a" | "b", id: string | null) => {
    if (!id) return;
    void (async () => {
      try {
        const record = await fetchLog(id);
        if (!record) return;
        const log = parseLog(record.csv);
        setError(null);
        const value = { name: record.name, log };
        if (side === "a") setA(value);
        else setB(value);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Log konnte nicht geladen werden.");
      }
    })();
  }, []);

  const comparison = useMemo(() => (a && b ? compareLogs(a.log, b.log) : null), [a, b]);
  const overlay = useMemo(
    () => (a && b ? buildOverlay(a.log, b.log, channel, { axis, align }) : null),
    [a, b, channel, axis, align],
  );

  const historyData = history.map((h) => ({ value: h.id, label: h.name }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <IconChip size={44}>
          <IconArrowsDiff size={22} stroke={1.6} />
        </IconChip>
        <PageHeader
          title="Log-Vergleich"
          description="Zwei Datenlogs (Baseline vs. Comparison) gegenüberstellen und überlagern."
        />
      </div>

      {error && (
        <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <LogPicker
          title="Log A · Baseline"
          side="a"
          current={a}
          historyData={historyData}
          historyLoading={historyLoading}
          onPickHistory={pickHistory}
          onFile={handleFile}
          onSample={() =>
            ingest(
              "a",
              "Baseline (Beispiel).csv",
              makeSampleCsv({ vin: "WBSCMPA0SYNTH001", peakBoost: 18 }),
            )
          }
        />
        <LogPicker
          title="Log B · Comparison"
          side="b"
          current={b}
          historyData={historyData}
          historyLoading={historyLoading}
          onPickHistory={pickHistory}
          onFile={handleFile}
          onSample={() =>
            ingest(
              "b",
              "Comparison (Beispiel).csv",
              makeSampleCsv({
                vin: "WBSCMPB0SYNTH002",
                peakBoost: 22,
                knockDeg: -4,
                peakIat: 55,
              }),
            )
          }
        />
      </div>

      {comparison && a && b && (
        <>
          <Panel
            title="Key-Metrics · Delta (B − A)"
            description={`Über das erkannte WOT-Fenster je Log · A ab ${fmtAnchor(
              comparison.alignment.a.offset,
            )}, B ab ${fmtAnchor(comparison.alignment.b.offset)}`}
          >
            <div data-testid="diff-cards" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {comparison.metrics.map((m) => {
                const d = fmtDelta(m);
                return (
                  <MetricTile
                    key={m.key}
                    label={m.label}
                    value={fmtNum(m.b, m.unit)}
                    hint={
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-flex flex-none items-center rounded-full border px-1.5 py-px text-[10px] font-semibold"
                          style={{
                            color: d.token,
                            borderColor: `color-mix(in srgb, ${d.token} 40%, transparent)`,
                          }}
                        >
                          {d.text}
                        </span>
                        <span className="truncate text-dim">A: {fmtNum(m.a, m.unit)}</span>
                      </span>
                    }
                  />
                );
              })}
            </div>
          </Panel>

          <Panel title="Overlay">
            <SegmentedControl
              className="mb-3"
              label="Overlay-Kanal"
              value={channel}
              onChange={(v) => setChannel(v as OverlayChannel)}
              options={CHANNEL_OPTIONS.map((o) => ({
                value: o.value as OverlayChannel,
                label: o.label,
              }))}
              data-testid="overlay-channel"
            />
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <SegmentedControl
                label="Overlay-Achse"
                value={axis}
                onChange={(v) => setAxis(v as OverlayAxis)}
                options={AXIS_OPTIONS.map((o) => ({ value: o.value as OverlayAxis, label: o.label }))}
                data-testid="overlay-axis"
              />
              <SegmentedControl
                label="Ausrichtung"
                value={align}
                onChange={(v) => setAlign(v as AlignMode)}
                options={ALIGN_OPTIONS.map((o) => ({ value: o.value as AlignMode, label: o.label }))}
                // Alignment shifts the TIME axis; on the RPM axis every sample is
                // already placed by engine speed, so the toggle has no effect.
                disabled={axis === "rpm"}
                data-testid="overlay-align"
              />
            </div>
            {overlay?.approximateAlignment && (
              <Alert tone="watch" className="mb-3" icon={<IconAlertCircle size={16} />}>
                Kein Pedal-Kanal in mindestens einem Log – der WOT-Nullpunkt wurde aus dem
                Drehzahlverlauf geschätzt.
              </Alert>
            )}
            <div className="mb-3 flex flex-wrap gap-5">
              <LegendItem color={SERIES_COLORS.primary} style="solid" label={`${a.name} (A)`} />
              <LegendItem color={SERIES_COLORS.secondary} style="dashed" label={`${b.name} (B)`} />
              {overlay?.hasRef && (
                <LegendItem
                  color={SERIES_COLORS.reference}
                  style="dotted"
                  label={`gepunktet: ${overlay.refLabel}`}
                />
              )}
            </div>
            {overlay && (
              <Suspense fallback={<OverlayChartSkeleton />}>
                <OverlayChart overlay={overlay} nameA={a.name} nameB={b.name} />
              </Suspense>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function LogPicker({
  title,
  side,
  current,
  historyData,
  historyLoading,
  onPickHistory,
  onFile,
  onSample,
}: {
  title: string;
  side: "a" | "b";
  current: Side | null;
  historyData: { value: string; label: string }[];
  historyLoading: boolean;
  onPickHistory: (side: "a" | "b", id: string | null) => void;
  onFile: (side: "a" | "b", file: File | null) => void;
  onSample: () => void;
}) {
  return (
    <Panel className="[&]:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        {current && (
          <Badge data-testid={`picked-${side}`}>
            {current.log.rowCount.toLocaleString("de-DE")} Zeilen
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {/* One clamped line either way: a long file name must not reflow the
            controls underneath it. */}
        <p className={`truncate text-sm ${current ? "font-medium" : "text-dim"}`}>
          {current ? current.name : "Noch kein Log gewählt."}
        </p>
        {/* The history row is ALWAYS present and always the same height:
            skeleton while the list loads, then the control — disabled with an
            explanatory placeholder when nothing is stored yet. Rendering it
            conditionally used to grow both cards mid-load and swallow clicks. */}
        {historyLoading ? (
          <Skeleton className={CONTROL_SKELETON_CLASS} data-testid={`history-skeleton-${side}`} />
        ) : (
          <SelectShell>
            <Select
              aria-label={`${title} aus Historie wählen`}
              defaultValue=""
              disabled={historyData.length === 0}
              onChange={(event) => onPickHistory(side, event.currentTarget.value || null)}
              data-testid={`history-${side}`}
            >
              <option value="">
                {historyData.length > 0 ? "Aus Historie wählen…" : "Keine gespeicherten Logs"}
              </option>
              {historyData.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </SelectShell>
        )}
        <div className="flex flex-wrap gap-2">
          <FilePicker
            accept=".csv,.log,.txt,text/csv,text/plain"
            className="min-h-9 px-3 text-[13px] sm:min-h-9"
            onChange={(event) => onFile(side, event.currentTarget.files?.[0] ?? null)}
          >
            <IconFileText size={14} />
            Datei
          </FilePicker>
          <Button variant="ghost" size="sm" onClick={onSample}>
            <IconSparkles size={14} />
            Beispiel
          </Button>
        </div>
      </div>
    </Panel>
  );
}
