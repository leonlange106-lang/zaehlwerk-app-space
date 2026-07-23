import type { PullHealth, PullStatus } from "./evaluate-log-pull";

// Thin client for the server-persisted log store (/api/apps/log-analyzer/logs).
// Uploaded logs live server-side now, so these replace the old localStorage
// history helpers. The raw CSV comes back on fetch and is re-parsed locally.

export interface LogSummaryDTO {
  id: string;
  name: string;
  source: string;
  sourceUrl: string | null;
  rowCount: number;
  vin: string | null;
  vehicle: string | null;
  status: PullStatus;
  health: PullHealth;
  recordedAt: string | null;
  octane: string | null;
  tags: string[];
  createdAt: string;
}

export interface LogRecordDTO extends LogSummaryDTO {
  csv: string;
  mapVersion: string | null;
  software: string | null;
  loggedAt: string | null;
}

export interface LogUploadFile {
  name: string;
  csv: string;
  source?: "upload" | "remote";
  sourceUrl?: string | null;
}

const BASE = "/api/apps/log-analyzer/logs";

/** Upload one or many logs (bulk). Returns the created summaries. */
export async function uploadLogs(files: LogUploadFile[]): Promise<LogSummaryDTO[]> {
  const response = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Upload fehlgeschlagen.");
  return data.logs as LogSummaryDTO[];
}

/** List all stored logs (summaries, newest first). */
export async function fetchLogs(): Promise<LogSummaryDTO[]> {
  const response = await fetch(BASE, { cache: "no-store" });
  if (!response.ok) throw new Error("Logs konnten nicht geladen werden.");
  const data = await response.json();
  return data.logs as LogSummaryDTO[];
}

/** Fetch one full log record (incl. CSV), or null if missing. */
export async function fetchLog(id: string): Promise<LogRecordDTO | null> {
  const response = await fetch(`${BASE}/${id}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Log konnte nicht geladen werden.");
  const data = await response.json();
  return data.log as LogRecordDTO;
}

/** Update the octane / free tags on a log. */
export async function patchLogTags(
  id: string,
  patch: { octane?: string | null; tags?: string[] },
): Promise<LogSummaryDTO | null> {
  const response = await fetch(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Tags konnten nicht gespeichert werden.");
  const data = await response.json();
  return data.log as LogSummaryDTO;
}

/** Delete a stored log. */
export async function deleteLogById(id: string): Promise<boolean> {
  const response = await fetch(`${BASE}/${id}`, { method: "DELETE" });
  return response.ok;
}
