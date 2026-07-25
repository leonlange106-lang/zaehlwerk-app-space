"use client";

import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  Progress,
  SimpleGrid,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { MetricChartSkeleton, type MetricPoint } from "./AdminChartFrame";
import {
  IconCpu,
  IconDatabase,
  IconDeviceDesktop,
  IconServerBolt,
  IconTrash,
} from "@tabler/icons-react";

// Admin-only ops panel on the App Space landing page: live host/container
// metrics (CPU, memory, disk) with rolling graphs, plus a manual cache-clear.
// Metrics are polled every POLL_MS; the client keeps a rolling window so the
// charts animate without any server-side history.

interface Metrics {
  timestamp: number;
  cpu: { usagePct: number; cores: number; load1: number; load5: number; load15: number };
  memory: { usedMb: number; totalMb: number; usedPct: number };
  disk: { usedGb: number; totalGb: number; usedPct: number } | null;
  process: { rssMb: number; heapUsedMb: number; uptimeS: number };
  host: { uptimeS: number; platform: string; arch: string; nodeVersion: string; hostname: string };
}

// Recharts (~103 KB gzip) lives behind this boundary — see AdminMetricsChart.
const MetricChart = lazy(() =>
  import("./AdminMetricsChart").then((m) => ({ default: m.MetricChart })),
);

type Point = MetricPoint;

const POLL_MS = 2000;
const MAX_POINTS = 40;

// Single-series accents (each chart names its own metric — no legend needed).
const CPU_COLOR = "#fd7e14";
const MEM_COLOR = "#4dabf7";

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function AdminPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/system/metrics", { cache: "no-store" });
      if (!res.ok) {
        setError(res.status === 403 ? "Kein Admin-Zugriff." : "Metriken nicht verfügbar.");
        return;
      }
      const m = (await res.json()) as Metrics;
      setError(null);
      setMetrics(m);
      setHistory((prev) => {
        const label = new Date(m.timestamp).toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        const next = [...prev, { t: m.timestamp, label, cpu: m.cpu.usagePct, mem: m.memory.usedPct }];
        return next.slice(-MAX_POINTS);
      });
    } catch {
      setError("Metriken nicht verfügbar (Netzwerkfehler).");
    }
  }, []);

  useEffect(() => {
    // poll() only setState()s after an async fetch, never synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void poll();
    timer.current = setInterval(() => void poll(), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [poll]);

  const clearCache = useCallback(async () => {
    setClearing(true);
    setClearResult(null);
    try {
      const res = await fetch("/api/system/cache/clear", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setClearResult(data.error ?? "Cache konnte nicht geleert werden.");
        return;
      }
      setClearResult(`Cache geleert – ${data.freedMb ?? 0} MB freigegeben.`);
    } catch {
      setClearResult("Cache konnte nicht geleert werden (Netzwerkfehler).");
    } finally {
      setClearing(false);
    }
  }, []);

  return (
    <Card withBorder radius="md" p="lg" maw={1100} mx="auto" w="100%">
      <Group justify="space-between" mb="md" wrap="wrap">
        <Group gap="xs">
          <ThemeIcon variant="light" color="slate" radius="md" size={32}>
            <IconServerBolt size={18} stroke={1.6} />
          </ThemeIcon>
          <div>
            <Title order={4}>Admin · System</Title>
            {metrics && (
              <Text size="xs" c="dimmed">
                {metrics.host.hostname} · {metrics.host.platform}/{metrics.host.arch} ·{" "}
                Node {metrics.host.nodeVersion} · Host-Uptime {fmtUptime(metrics.host.uptimeS)}
              </Text>
            )}
          </div>
        </Group>
        <Button
          size="xs"
          color="red"
          variant="light"
          leftSection={<IconTrash size={14} />}
          loading={clearing}
          onClick={() => void clearCache()}
          data-testid="clear-cache"
        >
          Cache leeren
        </Button>
      </Group>

      {error && (
        <Alert color="red" variant="light" mb="md">
          {error}
        </Alert>
      )}
      {clearResult && (
        <Alert color="teal" variant="light" mb="md" onClose={() => setClearResult(null)} withCloseButton>
          {clearResult}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mb="lg">
        <Stat
          icon={<IconCpu size={16} />}
          label="CPU"
          value={metrics ? `${metrics.cpu.usagePct}%` : "—"}
          sub={metrics ? `${metrics.cpu.cores} Kerne · Load ${metrics.cpu.load1}` : ""}
          pct={metrics?.cpu.usagePct ?? 0}
          color={CPU_COLOR}
        />
        <Stat
          icon={<IconDatabase size={16} />}
          label="Arbeitsspeicher"
          value={metrics ? `${metrics.memory.usedPct}%` : "—"}
          sub={metrics ? `${metrics.memory.usedMb} / ${metrics.memory.totalMb} MB` : ""}
          pct={metrics?.memory.usedPct ?? 0}
          color={MEM_COLOR}
        />
        <Stat
          icon={<IconServerBolt size={16} />}
          label="Disk (Daten)"
          value={metrics?.disk ? `${metrics.disk.usedPct}%` : "—"}
          sub={metrics?.disk ? `${metrics.disk.usedGb} / ${metrics.disk.totalGb} GB` : "n/v"}
          pct={metrics?.disk?.usedPct ?? 0}
          color="#20c997"
        />
        <Stat
          icon={<IconDeviceDesktop size={16} />}
          label="App-Prozess"
          value={metrics ? `${metrics.process.rssMb} MB` : "—"}
          sub={metrics ? `Uptime ${fmtUptime(metrics.process.uptimeS)}` : ""}
          pct={null}
          color="#868e96"
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Suspense fallback={<MetricChartSkeleton title="CPU-Auslastung (%)" />}>
          <MetricChart title="CPU-Auslastung (%)" data={history} dataKey="cpu" color={CPU_COLOR} />
        </Suspense>
        <Suspense fallback={<MetricChartSkeleton title="Speicher-Auslastung (%)" />}>
          <MetricChart title="Speicher-Auslastung (%)" data={history} dataKey="mem" color={MEM_COLOR} />
        </Suspense>
      </SimpleGrid>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  pct,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  pct: number | null;
  color: string;
}) {
  return (
    <Card withBorder radius="md" p="sm">
      <Group gap={6} mb={4}>
        <ThemeIcon variant="transparent" size={18} p={0} style={{ color }}>
          {icon}
        </ThemeIcon>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
      </Group>
      <Text fw={700} size="lg" lh={1.1}>
        {value}
      </Text>
      <Text size="xs" c="dimmed" mt={2}>
        {sub || " "}
      </Text>
      {pct !== null && (
        <Progress value={pct} color={pct >= 90 ? "red" : pct >= 75 ? "orange" : "teal"} size="xs" mt={6} radius="sm" />
      )}
    </Card>
  );
}
