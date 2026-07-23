import type { LogMeta, ParsedLog } from "./types";

// Client-side persistence for the analyzer. Two stores, deliberately:
//  - the ACTIVE log lives in sessionStorage and is a one-shot handoff between
//    routes (Remote Import / History → Analyzer). It's consumed on read.
//  - the HISTORY lives in localStorage so recently analyzed logs survive a
//    reload and can be reopened. Everything is browser-local; no server round
//    trip and no server-side storage of (potentially sensitive) vehicle data.

const ACTIVE_KEY = "log-analyzer:active";
const HISTORY_KEY = "log-analyzer:history";
const MAX_HISTORY = 8;

export interface StoredLog {
  id: string;
  name: string;
  source: "upload" | "remote";
  sourceUrl?: string;
  importedAt: number;
  log: ParsedLog;
}

/** Lightweight projection used for the history list (no bulky series arrays). */
export interface HistorySummary {
  id: string;
  name: string;
  source: "upload" | "remote";
  sourceUrl?: string;
  importedAt: number;
  rowCount: number;
  meta: LogMeta;
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function newLogId(): string {
  if (hasWindow() && "randomUUID" in crypto) return crypto.randomUUID();
  return `log-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Stash a log for the next route to pick up (one-shot). */
export function setActiveLog(entry: StoredLog): void {
  if (!hasWindow()) return;
  try {
    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage may be unavailable/full — non-fatal, the target route
    // simply shows its empty state.
  }
}

/** Read and CLEAR the pending active log, if any. */
export function takeActiveLog(): StoredLog | null {
  if (!hasWindow()) return null;
  try {
    const raw = sessionStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(ACTIVE_KEY);
    return JSON.parse(raw) as StoredLog;
  } catch {
    return null;
  }
}

function readHistory(): StoredLog[] {
  if (!hasWindow()) return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredLog[]) : [];
  } catch {
    return [];
  }
}

function writeHistory(entries: StoredLog[]): void {
  if (!hasWindow()) return;
  // Trim oldest-first until it fits under the browser quota. A few large logs
  // shouldn't wipe the whole history, so shrink rather than give up entirely.
  const list = [...entries];
  while (list.length > 0) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
      return;
    } catch {
      list.pop();
    }
  }
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}

/** Insert/replace a log at the top of the history (dedupe by id, cap length). */
export function addToHistory(entry: StoredLog): void {
  const existing = readHistory().filter((e) => e.id !== entry.id);
  writeHistory([entry, ...existing].slice(0, MAX_HISTORY));
}

/** History as summaries, newest first. */
export function listHistory(): HistorySummary[] {
  return readHistory().map((e) => ({
    id: e.id,
    name: e.name,
    source: e.source,
    sourceUrl: e.sourceUrl,
    importedAt: e.importedAt,
    rowCount: e.log.rowCount,
    meta: e.log.meta,
  }));
}

export function getHistoryLog(id: string): StoredLog | null {
  return readHistory().find((e) => e.id === id) ?? null;
}

export function removeFromHistory(id: string): void {
  writeHistory(readHistory().filter((e) => e.id !== id));
}

export function clearHistory(): void {
  if (!hasWindow()) return;
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}
