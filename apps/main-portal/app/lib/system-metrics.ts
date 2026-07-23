import os from "node:os";
import { statfs } from "node:fs/promises";

// Lightweight host/container metrics for the admin panel. Reads what's available
// from the Node runtime + os module (works inside the LXC/Docker container and
// on a dev box). CPU usage is a delta between successive reads, so the first
// sample reports 0 and subsequent polls report real utilisation.

export interface SystemMetrics {
  timestamp: number;
  cpu: {
    usagePct: number;
    cores: number;
    load1: number;
    load5: number;
    load15: number;
  };
  memory: { usedMb: number; totalMb: number; usedPct: number };
  disk: { usedGb: number; totalGb: number; usedPct: number } | null;
  process: { rssMb: number; heapUsedMb: number; uptimeS: number };
  host: { uptimeS: number; platform: string; arch: string; nodeVersion: string; hostname: string };
}

// CPU delta state: total/idle jiffies across all cores at the previous read.
let prevCpu: { total: number; idle: number } | null = null;

function cpuTimes(): { total: number; idle: number } {
  let total = 0;
  let idle = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
    idle += t.idle;
  }
  return { total, idle };
}

function cpuUsagePct(): number {
  const now = cpuTimes();
  if (!prevCpu) {
    prevCpu = now;
    return 0;
  }
  const totalDelta = now.total - prevCpu.total;
  const idleDelta = now.idle - prevCpu.idle;
  prevCpu = now;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
}

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

async function diskUsage(path: string): Promise<SystemMetrics["disk"]> {
  try {
    const s = await statfs(path);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const used = total - free;
    if (total <= 0) return null;
    return {
      usedGb: Math.round((used / GB) * 10) / 10,
      totalGb: Math.round((total / GB) * 10) / 10,
      usedPct: Math.round((used / total) * 100),
    };
  } catch {
    return null;
  }
}

/** Collect a point-in-time snapshot of host/container metrics. */
export async function collectMetrics(): Promise<SystemMetrics> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const [load1, load5, load15] = os.loadavg();
  const mem = process.memoryUsage();
  // The data volume is what fills up (see deploy notes); fall back to cwd.
  const disk = await diskUsage(process.env.UPDATE_DATA_DIR ?? process.env.DATA_DIR ?? process.cwd());

  return {
    timestamp: Date.now(),
    cpu: {
      usagePct: cpuUsagePct(),
      cores: os.cpus().length,
      load1: Math.round(load1 * 100) / 100,
      load5: Math.round(load5 * 100) / 100,
      load15: Math.round(load15 * 100) / 100,
    },
    memory: {
      usedMb: Math.round(usedMem / MB),
      totalMb: Math.round(totalMem / MB),
      usedPct: Math.round((usedMem / totalMem) * 100),
    },
    disk,
    process: {
      rssMb: Math.round(mem.rss / MB),
      heapUsedMb: Math.round(mem.heapUsed / MB),
      uptimeS: Math.round(process.uptime()),
    },
    host: {
      uptimeS: Math.round(os.uptime()),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      hostname: os.hostname(),
    },
  };
}
