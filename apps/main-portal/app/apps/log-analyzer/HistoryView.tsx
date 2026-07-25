"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { notifications } from "@mantine/notifications";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Skeleton,
  Stack,
  TagsInput,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconChartHistogram,
  IconClockHour4,
  IconGasStation,
  IconTag,
  IconTrash,
} from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StatusBadge, type StatusTone } from "@/app/components/ui/StatusBadge";
import { setActiveLogId } from "./lib/log-store";
import {
  deleteLogById,
  fetchLogs,
  patchLogTags,
  type LogSummaryDTO,
} from "./lib/log-api";
import type { PullHealth, PullStatus } from "./lib/evaluate-log-pull";

// Server-persisted overview of all uploaded logs, sorted chronologically by the
// drive time parsed from the filename and grouped by day (newest first). Entries
// show the pull status and a hardware-health badge, can be tagged with the real
// octane driven and free tags, reopened, or deleted. All stored server-side.

// Roughly one LogRow (card padding + title/badges + meta line + the octane and
// tag inputs). Rows are content-sized, so this only has to be close enough that
// the arriving list grows into space the page already reserved.
const LOG_ROW_HEIGHT = 132;

// Above this many logs the list is windowed. Below it a plain stack is simpler
// and keeps the natural page flow (no inner scroll area) for the common case —
// same trade-off as the reading history table. It matters here because the
// watch-folder importer can accumulate logs indefinitely, and every row carries
// two live Mantine inputs, so an unwindowed list of a few hundred is thousands
// of DOM nodes and a visibly sluggish page.
const VIRTUALIZE_THRESHOLD = 40;
/** Height of a day heading (uppercase caption + the stack gap around it). */
const GROUP_HEADER_HEIGHT = 38;
const VIEWPORT_HEIGHT = 640;

// Verdicts go through StatusBadge (colour + icon, never colour alone); the
// source tag is a plain label, not a status, so it stays a neutral badge.
const STATUS_META: Record<PullStatus, { label: string; tone: StatusTone }> = {
  verified: { label: "VERIFIED", tone: "ok" },
  partial: { label: "PARTIAL", tone: "watch" },
  invalid: { label: "INVALID", tone: "risk" },
};

const SOURCE_META: Record<string, { label: string; color: string }> = {
  upload: { label: "Upload", color: "orange" },
  remote: { label: "Remote", color: "cyan" },
  ingest: { label: "Auto · API", color: "slate" },
  watch: { label: "Auto · Ordner", color: "slate" },
};

const HEALTH_META: Record<PullHealth, { label: string; tone: StatusTone }> = {
  safe: { label: "Hardware-sicher", tone: "ok" },
  caution: { label: "Beobachten", tone: "watch" },
  danger: { label: "Hardware-Risiko", tone: "risk" },
};

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dayFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

interface DayGroup {
  key: string;
  label: string;
  logs: LogSummaryDTO[];
}

/** Group already-sorted logs by their drive day; undated logs go last. */
function groupByDay(logs: LogSummaryDTO[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const index = new Map<string, DayGroup>();
  for (const log of logs) {
    const d = log.recordedAt ? new Date(log.recordedAt) : null;
    const key = d ? d.toISOString().slice(0, 10) : "undated";
    let group = index.get(key);
    if (!group) {
      group = { key, label: d ? dayFormatter.format(d) : "Ohne Datum", logs: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.logs.push(log);
  }
  return groups;
}

/** A windowed list can only measure a flat sequence, so day headings become rows. */
type FlatRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "log"; key: string; log: LogSummaryDTO };

function flattenGroups(groups: DayGroup[]): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const group of groups) {
    rows.push({
      kind: "header",
      key: `h-${group.key}`,
      label: `${group.label} · ${group.logs.length} Log${group.logs.length === 1 ? "" : "s"}`,
    });
    for (const log of group.logs) rows.push({ kind: "log", key: log.id, log });
  }
  return rows;
}

export function HistoryView() {
  const router = useRouter();
  const [items, setItems] = useState<LogSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const logs = await fetchLogs();
        if (!cancelled) setItems(logs);
      } catch {
        if (!cancelled) {
          setError("Logs konnten nicht geladen werden.");
          setItems([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Realtime: when a log is auto-imported (ingestion API or watch-folder), the
  // server pushes an SSE event — show a toast and refresh the list in place.
  useEffect(() => {
    const source = new EventSource("/api/apps/log-analyzer/logs/stream");
    const onIngested = (e: MessageEvent) => {
      let data: { name?: string; ingestStatus?: string; duplicate?: boolean } = {};
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      const name = data.name ?? "Log";
      notifications.show({
        color: data.duplicate ? "gray" : data.ingestStatus === "VERIFIED" ? "teal" : "orange",
        title: data.duplicate ? "Log bereits vorhanden" : "Neuer Log automatisch verarbeitet",
        message: `${name}${data.duplicate ? "" : ` (Status: ${data.ingestStatus ?? "?"})`}`,
      });
      // Pull the fresh list so the new row (and its badges) appears immediately.
      void fetchLogs()
        .then((logs) => setItems(logs))
        .catch(() => {});
    };
    source.addEventListener("ingested", onIngested as EventListener);
    return () => {
      source.removeEventListener("ingested", onIngested as EventListener);
      source.close();
    };
  }, []);

  const open = useCallback(
    (id: string) => {
      setActiveLogId(id);
      router.push("/apps/log-analyzer");
    },
    [router],
  );

  const remove = useCallback(async (id: string) => {
    const ok = await deleteLogById(id);
    if (ok) setItems((prev) => (prev ? prev.filter((l) => l.id !== id) : prev));
  }, []);

  const saveTags = useCallback(
    async (id: string, patch: { label?: string | null; octane?: string | null; tags?: string[] }) => {
      const updated = await patchLogTags(id, patch);
      if (updated) setItems((prev) => (prev ? prev.map((l) => (l.id === id ? updated : l)) : prev));
    },
    [],
  );

  // Stable per-row handlers, so a memoized LogRow only re-renders when its own
  // log actually changes rather than on every list update.
  const handlers: RowHandlers = useMemo(
    () => ({
      onOpen: open,
      onRemove: (id) => void remove(id),
      onSaveLabel: (id, label) => void saveTags(id, { label }),
      onSaveOctane: (id, octane) => void saveTags(id, { octane }),
      onSaveTags: (id, tags) => void saveTags(id, { tags }),
    }),
    [open, remove, saveTags],
  );

  const groups = useMemo(() => (items ? groupByDay(items) : []), [items]);

  return (
    <Stack gap="lg">
      {/* The header renders immediately, loaded or not: swapping the WHOLE view
          from a spinner to the list pushed the page title in from the top. */}
      <Group gap="md">
        <ThemeIcon variant="light" color="orange" radius="md" size={44}>
          <IconClockHour4 size={24} stroke={1.5} />
        </ThemeIcon>
        <div>
          <Title order={2}>Log-Übersicht</Title>
          <Text c="dimmed" size="sm">
            Alle gespeicherten Logs mit Pull-Status und Tags (real gefahrene Oktanzahl u.&nbsp;a.).
          </Text>
        </div>
      </Group>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {items === null ? (
        // Placeholder rows the height of a real one, so the list grows into the
        // space it already occupies instead of appearing below a spinner.
        <Stack gap="sm" data-testid="log-list-skeleton">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={LOG_ROW_HEIGHT} radius="md" />
          ))}
        </Stack>
      ) : items.length === 0 ? (
        <Card withBorder radius="md" p="xl">
          <Text c="dimmed" ta="center" size="sm">
            Noch keine Logs gespeichert. Lade im Analyzer eine oder mehrere CSV-Dateien hoch.
          </Text>
        </Card>
      ) : items.length > VIRTUALIZE_THRESHOLD ? (
        <VirtualizedLogList rows={flattenGroups(groups)} handlers={handlers} />
      ) : (
        <Stack gap="lg">
          {groups.map((group) => (
            <Stack key={group.key} gap="sm">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                {group.label} · {group.logs.length} Log{group.logs.length === 1 ? "" : "s"}
              </Text>
              {group.logs.map((log) => (
                <LogRow key={log.id} log={log} handlers={handlers} />
              ))}
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** Callbacks shared by every row; identity-stable so `memo` below can bite. */
type RowHandlers = {
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onSaveLabel: (id: string, label: string) => void;
  onSaveOctane: (id: string, octane: string) => void;
  onSaveTags: (id: string, tags: string[]) => void;
};

// Memoized: editing the tags on one row re-renders the whole list, and every row
// holds two Mantine inputs. Without this a long list re-mounts all of them for a
// single keystroke's worth of state.
const LogRow = memo(function LogRow({
  log,
  handlers,
}: {
  log: LogSummaryDTO;
  handlers: RowHandlers;
}) {
  const status = STATUS_META[log.status];
  const health = HEALTH_META[log.health];
  const [label, setLabel] = useState(log.label ?? "");
  const [octane, setOctane] = useState(log.octane ?? "");

  return (
    <Card withBorder radius="md" p="md" data-testid="log-row">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Group gap="xs" wrap="wrap">
            <Text fw={600} style={{ wordBreak: "break-all" }}>
              {log.label ?? log.name}
            </Text>
            <StatusBadge
              tone={health.tone}
              label={health.label}
              variant="filled"
              size="sm"
              data-testid="log-health"
            />
            <StatusBadge
              tone={status.tone}
              label={status.label}
              size="sm"
              data-testid="log-status"
            />
            <Badge variant="outline" color={SOURCE_META[log.source]?.color ?? "orange"} size="sm">
              {SOURCE_META[log.source]?.label ?? "Upload"}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={2}>
            {[
              log.label ? log.name : null,
              log.recordedAt ? `gefahren ${timeFormatter.format(new Date(log.recordedAt))} Uhr` : null,
              log.vehicle,
              log.vin,
              `${log.rowCount} Zeilen`,
              `Upload ${dateFormatter.format(new Date(log.createdAt))}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>

          <Group gap="sm" mt="sm" align="flex-end" wrap="wrap">
            <TextInput
              label="Bezeichnung"
              description="Benannte Logs erscheinen im Navigationsmenü"
              size="xs"
              w={230}
              leftSection={<IconTag size={14} />}
              placeholder="z. B. Stage 2 Referenzlauf"
              value={label}
              onChange={(e) => setLabel(e.currentTarget.value)}
              onBlur={() => {
                if ((log.label ?? "") !== label) handlers.onSaveLabel(log.id, label);
              }}
              data-testid="log-label"
            />
            <TextInput
              label="Oktan / Kraftstoff"
              size="xs"
              w={150}
              leftSection={<IconGasStation size={14} />}
              placeholder="z. B. 100 RON"
              value={octane}
              onChange={(e) => setOctane(e.currentTarget.value)}
              onBlur={() => {
                if ((log.octane ?? "") !== octane) handlers.onSaveOctane(log.id, octane);
              }}
              data-testid="log-octane"
            />
            <TagsInput
              label="Tags"
              size="xs"
              w={260}
              placeholder="Tag hinzufügen…"
              value={log.tags}
              onChange={(tags) => handlers.onSaveTags(log.id, tags)}
              data-testid="log-tags"
            />
          </Group>
        </div>

        <Group gap="xs" wrap="nowrap">
          <Button
            size="xs"
            color="orange"
            variant="light"
            leftSection={<IconChartHistogram size={14} />}
            onClick={() => handlers.onOpen(log.id)}
          >
            Öffnen
          </Button>
          <Tooltip label="Log löschen" withArrow>
            <ActionIcon
              color="red"
              variant="subtle"
              onClick={() => handlers.onRemove(log.id)}
              aria-label="Log löschen"
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Card>
  );
});

/**
 * Windowed variant used once the list gets long. Rows are content-sized (tags
 * wrap, badges reflow), so `measureElement` reports their real heights and the
 * estimates below only have to be close enough to keep the scrollbar honest
 * before a row has been seen.
 */
function VirtualizedLogList({ rows, handlers }: { rows: FlatRow[]; handlers: RowHandlers }) {
  const parentRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual returns live (non-memoizable) functions, so React Compiler
  // intentionally skips memoizing this component — expected and safe here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      rows[index]!.kind === "header" ? GROUP_HEADER_HEIGHT : LOG_ROW_HEIGHT,
    overscan: 6,
    gap: 8,
  });

  return (
    <div
      ref={parentRef}
      style={{ height: VIEWPORT_HEIGHT, overflow: "auto" }}
      role="region"
      aria-label="Gespeicherte Logs"
      tabIndex={0}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!;
          return (
            <div
              key={row.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
            >
              {row.kind === "header" ? (
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" pt="md">
                  {row.label}
                </Text>
              ) : (
                <LogRow log={row.log} handlers={handlers} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
