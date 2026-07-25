"use client";

import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MetricChartSkeleton, type MetricPoint } from "./AdminChartFrame";
import { Button } from "./components/ui/Button";
import { Panel } from "./components/ui/Panel";
import { Alert } from "./components/ui/primitives";
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
    <Panel
      className="mx-auto w-full max-w-6xl"
      title="Admin · System"
      icon={<IconServerBolt size={17} stroke={1.7} />}
      description={
        metrics
          ? `${metrics.host.hostname} · ${metrics.host.platform}/${metrics.host.arch} · Node ${metrics.host.nodeVersion} · Host-Uptime ${fmtUptime(metrics.host.uptimeS)}`
          : undefined
      }
      action={
        <Button
          variant="danger"
          size="sm"
          disabled={clearing}
          onClick={() => void clearCache()}
          data-testid="clear-cache"
        >
          <IconTrash size={14} />
          {clearing ? "Wird geleert…" : "Cache leeren"}
        </Button>
      }
    >
      {error && (
        <Alert tone="risk" role="alert" className="mb-4">
          {error}
        </Alert>
      )}
      {clearResult && (
        <Alert tone="ok" className="mb-4">
          {clearResult}
        </Alert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          color="var(--zw-ok)"
        />
        <Stat
          icon={<IconDeviceDesktop size={16} />}
          label="App-Prozess"
          value={metrics ? `${metrics.process.rssMb} MB` : "—"}
          sub={metrics ? `Uptime ${fmtUptime(metrics.process.uptimeS)}` : ""}
          pct={null}
          color="var(--zw-neutral)"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Suspense fallback={<MetricChartSkeleton title="CPU-Auslastung (%)" />}>
          <MetricChart title="CPU-Auslastung (%)" data={history} dataKey="cpu" color={CPU_COLOR} />
        </Suspense>
        <Suspense fallback={<MetricChartSkeleton title="Speicher-Auslastung (%)" />}>
          <MetricChart
            title="Speicher-Auslastung (%)"
            data={history}
            dataKey="mem"
            color={MEM_COLOR}
          />
        </Suspense>
      </div>
    </Panel>
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
  // The bar tightens as the resource fills: neutral, then watch, then risk. It
  // repeats the percentage that is already written above it, so colour alone
  // never carries the news.
  const barToken =
    pct === null
      ? null
      : pct >= 90
        ? "var(--zw-risk)"
        : pct >= 75
          ? "var(--zw-watch)"
          : "var(--zw-ok)";

  return (
    <div className="well p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="flex-none" style={{ color }} aria-hidden>
          {icon}
        </span>
        <p className="legend-label">{label}</p>
      </div>
      <p className="readout text-readout-sm">{value}</p>
      <p className="mt-0.5 text-xs text-dim">{sub || " "}</p>
      {barToken !== null && (
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-line">
          <span
            className="block h-full rounded-full transition-[width]"
            style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%`, background: barToken }}
          />
        </span>
      )}
    </div>
  );
}
