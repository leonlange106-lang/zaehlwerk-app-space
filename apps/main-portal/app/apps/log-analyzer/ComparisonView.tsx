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
import { OverlayChart } from "./OverlayChart";
import { LegendItem, SERIES_COLORS } from "./ChartLegend";
import { XS_INPUT_HEIGHT } from "./ui-metrics";

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

function fmtDelta(m: MetricDelta): { text: string; color: string } {
  if (m.delta === null) return { text: "—", color: "gray" };
  const rounded = Math.abs(m.delta) >= 100 ? Math.round(m.delta) : Math.round(m.delta * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  // Neutral colouring: we surface direction, not a value judgement.
  const color = rounded === 0 ? "gray" : rounded > 0 ? "blue" : "orange";
  return { text: `${sign}${rounded.toLocaleString("de-DE")}${m.unit ? ` ${m.unit}` : ""}`, color };
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
    <Stack gap="lg">
      <Group gap="md">
        <ThemeIcon variant="light" color="orange" radius="md" size={44}>
          <IconArrowsDiff size={24} stroke={1.5} />
        </ThemeIcon>
        <div>
          <Title order={2}>Log-Vergleich</Title>
          <Text c="dimmed" size="sm">
            Zwei Datenlogs (Baseline vs. Comparison) gegenüberstellen und überlagern.
          </Text>
        </div>
      </Group>

      {error && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <LogPicker
          title="Log A · Baseline"
          color="orange"
          side="a"
          current={a}
          historyData={historyData}
          historyLoading={historyLoading}
          onPickHistory={pickHistory}
          onFile={handleFile}
          onSample={() =>
            ingest("a", "Baseline (Beispiel).csv", makeSampleCsv({ vin: "WBSCMPA0SYNTH001", peakBoost: 18 }))
          }
        />
        <LogPicker
          title="Log B · Comparison"
          color="blue"
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
              makeSampleCsv({ vin: "WBSCMPB0SYNTH002", peakBoost: 22, knockDeg: -4, peakIat: 55 }),
            )
          }
        />
      </SimpleGrid>

      {comparison && a && b && (
        <>
          <Card withBorder radius="md" p="lg" data-testid="diff-cards">
            <Title order={5}>Key-Metrics · Delta (B − A)</Title>
            <Text size="xs" c="dimmed" mb="md">
              Über das erkannte WOT-Fenster je Log · A ab {fmtAnchor(comparison.alignment.a.offset)},
              B ab {fmtAnchor(comparison.alignment.b.offset)}
            </Text>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
              {comparison.metrics.map((m) => {
                const d = fmtDelta(m);
                return (
                  <Card withBorder radius="md" p="md" key={m.key}>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600} lh={1.3}>
                      {m.label}
                    </Text>
                    <Group gap={6} mt={4} align="baseline" wrap="nowrap">
                      <Text size="lg" fw={700}>
                        {fmtNum(m.b, m.unit)}
                      </Text>
                    </Group>
                    <Group gap={6} mt={4} wrap="nowrap">
                      <Badge size="sm" variant="light" color={d.color}>
                        {d.text}
                      </Badge>
                      <Text size="xs" c="dimmed">
                        A: {fmtNum(m.a, m.unit)}
                      </Text>
                    </Group>
                  </Card>
                );
              })}
            </SimpleGrid>
          </Card>

          <Card withBorder radius="md" p="lg">
            <Title order={5} mb="sm">
              Overlay
            </Title>
            <SegmentedControl
              size="xs"
              fullWidth
              mb="sm"
              value={channel}
              onChange={(v) => setChannel(v as OverlayChannel)}
              data={CHANNEL_OPTIONS}
              data-testid="overlay-channel"
            />
            <Group gap="sm" mb="md" grow>
              <SegmentedControl
                size="xs"
                value={axis}
                onChange={(v) => setAxis(v as OverlayAxis)}
                data={AXIS_OPTIONS}
                data-testid="overlay-axis"
              />
              <SegmentedControl
                size="xs"
                value={align}
                onChange={(v) => setAlign(v as AlignMode)}
                data={ALIGN_OPTIONS}
                // Alignment shifts the TIME axis; on the RPM axis every sample is
                // already placed by engine speed, so the toggle has no effect.
                disabled={axis === "rpm"}
                data-testid="overlay-align"
              />
            </Group>
            {overlay?.approximateAlignment && (
              <Alert color="yellow" variant="light" mb="sm" icon={<IconAlertCircle size={16} />}>
                Kein Pedal-Kanal in mindestens einem Log – der WOT-Nullpunkt wurde aus dem
                Drehzahlverlauf geschätzt.
              </Alert>
            )}
            <Group gap="lg" mb="sm">
              <LegendItem color={SERIES_COLORS.primary} style="solid" label={`${a.name} (A)`} />
              <LegendItem color={SERIES_COLORS.secondary} style="dashed" label={`${b.name} (B)`} />
              {overlay?.hasRef && (
                <LegendItem
                  color={SERIES_COLORS.reference}
                  style="dotted"
                  label={`gepunktet: ${overlay.refLabel}`}
                />
              )}
            </Group>
            {overlay && <OverlayChart overlay={overlay} nameA={a.name} nameB={b.name} />}
          </Card>
        </>
      )}
    </Stack>
  );
}

function LogPicker({
  title,
  color,
  side,
  current,
  historyData,
  historyLoading,
  onPickHistory,
  onFile,
  onSample,
}: {
  title: string;
  color: string;
  side: "a" | "b";
  current: Side | null;
  historyData: { value: string; label: string }[];
  historyLoading: boolean;
  onPickHistory: (side: "a" | "b", id: string | null) => void;
  onFile: (side: "a" | "b", file: File | null) => void;
  onSample: () => void;
}) {
  return (
    <Card withBorder radius="md" p="md">
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Text fw={600} size="sm">
          {title}
        </Text>
        {current && (
          <Badge variant="light" color={color} data-testid={`picked-${side}`}>
            {current.log.rowCount.toLocaleString("de-DE")} Zeilen
          </Badge>
        )}
      </Group>
      <Stack gap="sm">
        {/* One clamped line either way: a long file name must not reflow the
            controls underneath it. */}
        <Text size="sm" fw={current ? 500 : 400} c={current ? undefined : "dimmed"} lineClamp={1}>
          {current ? current.name : "Noch kein Log gewählt."}
        </Text>
        {/* The history row is ALWAYS present and always the same height:
            skeleton while the list loads, then the control — disabled with an
            explanatory placeholder when nothing is stored yet. Rendering it
            conditionally used to grow both cards mid-load and swallow clicks. */}
        {historyLoading ? (
          <Skeleton height={XS_INPUT_HEIGHT} radius="sm" data-testid={`history-skeleton-${side}`} />
        ) : (
          <Select
            placeholder={
              historyData.length > 0 ? "Aus Historie wählen…" : "Keine gespeicherten Logs"
            }
            data={historyData}
            disabled={historyData.length === 0}
            onChange={(id) => onPickHistory(side, id)}
            searchable
            clearable
            size="xs"
            data-testid={`history-${side}`}
          />
        )}
        <Group gap="xs">
          <FileButton onChange={(f) => onFile(side, f)} accept=".csv,.log,.txt,text/csv,text/plain">
            {(props) => (
              <Button {...props} size="xs" variant="light" color={color} leftSection={<IconFileText size={14} />}>
                Datei
              </Button>
            )}
          </FileButton>
          <Button size="xs" variant="subtle" color="slate" leftSection={<IconSparkles size={14} />} onClick={onSample}>
            Beispiel
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
