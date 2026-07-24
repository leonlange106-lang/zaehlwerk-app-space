"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { notifications } from "@mantine/notifications";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  TagsInput,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChartHistogram,
  IconClockHour4,
  IconGasStation,
  IconShieldCheck,
  IconTrash,
} from "@tabler/icons-react";
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

const STATUS_META: Record<PullStatus, { label: string; color: string }> = {
  verified: { label: "VERIFIED", color: "teal" },
  partial: { label: "PARTIAL", color: "yellow" },
  invalid: { label: "INVALID", color: "red" },
};

const SOURCE_META: Record<string, { label: string; color: string }> = {
  upload: { label: "Upload", color: "orange" },
  remote: { label: "Remote", color: "blue" },
  ingest: { label: "Auto · API", color: "grape" },
  watch: { label: "Auto · Ordner", color: "grape" },
};

const HEALTH_META: Record<PullHealth, { label: string; color: string; safe: boolean }> = {
  safe: { label: "Hardware-sicher", color: "green", safe: true },
  caution: { label: "Beobachten", color: "yellow", safe: false },
  danger: { label: "Hardware-Risiko", color: "red", safe: false },
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
    async (id: string, patch: { octane?: string | null; tags?: string[] }) => {
      const updated = await patchLogTags(id, patch);
      if (updated) setItems((prev) => (prev ? prev.map((l) => (l.id === id ? updated : l)) : prev));
    },
    [],
  );

  if (items === null) {
    return (
      <Group justify="center" py="xl">
        <Loader color="orange" />
      </Group>
    );
  }

  return (
    <Stack gap="lg">
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

      {items.length === 0 ? (
        <Card withBorder radius="md" p="xl">
          <Text c="dimmed" ta="center" size="sm">
            Noch keine Logs gespeichert. Lade im Analyzer eine oder mehrere CSV-Dateien hoch.
          </Text>
        </Card>
      ) : (
        <Stack gap="lg">
          {groupByDay(items).map((group) => (
            <Stack key={group.key} gap="sm">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                {group.label} · {group.logs.length} Log{group.logs.length === 1 ? "" : "s"}
              </Text>
              {group.logs.map((log) => (
                <LogRow
                  key={log.id}
                  log={log}
                  onOpen={() => open(log.id)}
                  onRemove={() => void remove(log.id)}
                  onSaveOctane={(octane) => void saveTags(log.id, { octane })}
                  onSaveTags={(tags) => void saveTags(log.id, { tags })}
                />
              ))}
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function LogRow({
  log,
  onOpen,
  onRemove,
  onSaveOctane,
  onSaveTags,
}: {
  log: LogSummaryDTO;
  onOpen: () => void;
  onRemove: () => void;
  onSaveOctane: (octane: string) => void;
  onSaveTags: (tags: string[]) => void;
}) {
  const status = STATUS_META[log.status];
  const health = HEALTH_META[log.health];
  const [octane, setOctane] = useState(log.octane ?? "");

  return (
    <Card withBorder radius="md" p="md" data-testid="log-row">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Group gap="xs" wrap="wrap">
            <Text fw={600} style={{ wordBreak: "break-all" }}>
              {log.name}
            </Text>
            <Badge
              color={health.color}
              variant="filled"
              size="sm"
              leftSection={
                health.safe ? <IconShieldCheck size={12} /> : <IconAlertTriangle size={12} />
              }
              data-testid="log-health"
            >
              {health.label}
            </Badge>
            <Badge color={status.color} variant="light" size="sm" data-testid="log-status">
              {status.label}
            </Badge>
            <Badge variant="light" color={SOURCE_META[log.source]?.color ?? "orange"} size="sm">
              {SOURCE_META[log.source]?.label ?? "Upload"}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={2}>
            {[
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
              label="Oktan / Kraftstoff"
              size="xs"
              w={150}
              leftSection={<IconGasStation size={14} />}
              placeholder="z. B. 100 RON"
              value={octane}
              onChange={(e) => setOctane(e.currentTarget.value)}
              onBlur={() => {
                if ((log.octane ?? "") !== octane) onSaveOctane(octane);
              }}
              data-testid="log-octane"
            />
            <TagsInput
              label="Tags"
              size="xs"
              w={260}
              placeholder="Tag hinzufügen…"
              value={log.tags}
              onChange={onSaveTags}
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
            onClick={onOpen}
          >
            Öffnen
          </Button>
          <Tooltip label="Log löschen" withArrow>
            <ActionIcon color="red" variant="subtle" onClick={onRemove} aria-label="Log löschen">
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Card>
  );
}
