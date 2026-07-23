"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { IconChartHistogram, IconClockHour4, IconGasStation, IconTrash } from "@tabler/icons-react";
import { setActiveLogId } from "./lib/log-store";
import {
  deleteLogById,
  fetchLogs,
  patchLogTags,
  type LogSummaryDTO,
} from "./lib/log-api";
import type { PullStatus } from "./lib/evaluate-log-pull";

// Server-persisted overview of all uploaded logs. Entries show the automatically
// evaluated pull status, can be tagged with the real octane driven and free
// tags, reopened in the analyzer, or deleted. Everything is stored server-side.

const STATUS_META: Record<PullStatus, { label: string; color: string }> = {
  verified: { label: "VERIFIED", color: "teal" },
  partial: { label: "PARTIAL", color: "yellow" },
  invalid: { label: "INVALID", color: "red" },
};

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

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
        <Stack gap="sm">
          {items.map((log) => (
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
  const [octane, setOctane] = useState(log.octane ?? "");

  return (
    <Card withBorder radius="md" p="md" data-testid="log-row">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Group gap="xs" wrap="wrap">
            <Text fw={600} style={{ wordBreak: "break-all" }}>
              {log.name}
            </Text>
            <Badge color={status.color} variant="filled" size="sm" data-testid="log-status">
              {status.label}
            </Badge>
            <Badge variant="light" color={log.source === "remote" ? "blue" : "orange"} size="sm">
              {log.source === "remote" ? "Remote" : "Upload"}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={2}>
            {[
              log.vehicle,
              log.vin,
              `${log.rowCount} Zeilen`,
              dateFormatter.format(new Date(log.createdAt)),
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
