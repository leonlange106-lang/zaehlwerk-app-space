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
  type MetricDelta,
  type OverlayChannel,
} from "./lib/compare-logs";
import { fetchLog, fetchLogs, type LogSummaryDTO } from "./lib/log-api";
import type { ParsedLog } from "./lib/types";
import { OverlayChart } from "./OverlayChart";

// Dual-log comparison workspace. Two logs — Baseline (A) and Comparison (B) —
// are loaded (from history or a fresh upload), reduced to key-metric diff cards
// and overlaid on a shared RPM axis. The heavy lifting is in compare-logs.ts;
// this component is orchestration + presentation.

interface Side {
  name: string;
  log: ParsedLog;
}

const OVERLAY_CHANNELS: { value: OverlayChannel; label: string }[] = [
  { value: "boostActual", label: "Boost Actual" },
  { value: "boostTarget", label: "Boost Target" },
  { value: "iat", label: "IAT" },
  { value: "rpm", label: "RPM" },
];

function fmtNum(v: number | null, unit: string | null): string {
  if (v === null) return "—";
  const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${rounded.toLocaleString("de-DE")}${unit ? ` ${unit}` : ""}`;
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
  const [channel, setChannel] = useState<OverlayChannel>("boostActual");
  const [history, setHistory] = useState<LogSummaryDTO[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const logs = await fetchLogs();
        if (!cancelled) setHistory(logs);
      } catch {
        // non-fatal — the file pickers still work without the stored list
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
    () => (a && b ? buildOverlay(a.log, b.log, channel) : null),
    [a, b, channel],
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
            <Title order={5} mb="md">
              Key-Metrics · Delta (B − A)
            </Title>
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
              mb="md"
              value={channel}
              onChange={(v) => setChannel(v as OverlayChannel)}
              data={OVERLAY_CHANNELS}
              data-testid="overlay-channel"
            />
            <Group gap="lg" mb="sm">
              <Group gap={6}>
                <span style={{ width: 22, height: 0, borderTop: "2px solid var(--mantine-color-orange-6)" }} />
                <Text size="xs" c="dimmed">
                  {a.name} (A)
                </Text>
              </Group>
              <Group gap={6}>
                <span
                  style={{
                    width: 22,
                    height: 0,
                    borderTop: "2px dashed var(--mantine-color-blue-6)",
                  }}
                />
                <Text size="xs" c="dimmed">
                  {b.name} (B)
                </Text>
              </Group>
            </Group>
            {overlay && <OverlayChart overlay={overlay} />}
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
  onPickHistory,
  onFile,
  onSample,
}: {
  title: string;
  color: string;
  side: "a" | "b";
  current: Side | null;
  historyData: { value: string; label: string }[];
  onPickHistory: (side: "a" | "b", id: string | null) => void;
  onFile: (side: "a" | "b", file: File | null) => void;
  onSample: () => void;
}) {
  return (
    <Card withBorder radius="md" p="md">
      <Group justify="space-between" mb="sm">
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
        {current ? (
          <Text size="sm" fw={500} style={{ wordBreak: "break-word" }}>
            {current.name}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            Noch kein Log gewählt.
          </Text>
        )}
        {historyData.length > 0 && (
          <Select
            placeholder="Aus Historie wählen…"
            data={historyData}
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
