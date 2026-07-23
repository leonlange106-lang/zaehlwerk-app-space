"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconChartHistogram, IconClockHour4, IconTrash } from "@tabler/icons-react";
import {
  clearHistory,
  getHistoryLog,
  listHistory,
  removeFromHistory,
  setActiveLog,
  type HistorySummary,
} from "./lib/log-store";

// Browser-local history of recently analyzed logs. Entries can be reopened
// (handed to the analyzer via the session store) or removed. Everything lives in
// localStorage — nothing is persisted server-side.

export function HistoryView() {
  const router = useRouter();
  const [items, setItems] = useState<HistorySummary[] | null>(null);

  // History lives in localStorage, so it can only be read after mount (never
  // during SSR). One-shot read on mount — no cascading-render concern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(listHistory());
  }, []);

  function open(id: string) {
    const entry = getHistoryLog(id);
    if (!entry) return;
    setActiveLog(entry);
    router.push("/apps/log-analyzer");
  }

  function remove(id: string) {
    removeFromHistory(id);
    setItems(listHistory());
  }

  function clearAll() {
    clearHistory();
    setItems([]);
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Group gap="md">
          <ThemeIcon variant="light" color="orange" radius="md" size={44}>
            <IconClockHour4 size={24} stroke={1.5} />
          </ThemeIcon>
          <div>
            <Title order={2}>Log-Historie</Title>
            <Text c="dimmed" size="sm">
              Zuletzt analysierte Logs (lokal in diesem Browser gespeichert).
            </Text>
          </div>
        </Group>
        {items && items.length > 0 && (
          <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />} onClick={clearAll}>
            Alle löschen
          </Button>
        )}
      </Group>

      {items !== null && items.length === 0 && (
        <Card withBorder radius="md" p="xl">
          <Text c="dimmed" ta="center" size="sm">
            Noch keine Logs analysiert. Lade im Analyzer eine Datei hoch oder importiere ein Log per
            Share-Link.
          </Text>
        </Card>
      )}

      <Stack gap="sm">
        {(items ?? []).map((item) => (
          <Card withBorder radius="md" p="md" key={item.id}>
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <div style={{ minWidth: 0 }}>
                <Group gap="xs" wrap="nowrap">
                  <Text fw={600} truncate>
                    {item.name}
                  </Text>
                  <Badge size="xs" variant="light" color={item.source === "remote" ? "blue" : "orange"}>
                    {item.source === "remote" ? "Remote" : "Upload"}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  {new Date(item.importedAt).toLocaleString("de-DE")} · {item.rowCount.toLocaleString("de-DE")} Zeilen
                  {item.meta.vehicle ? ` · ${item.meta.vehicle}` : ""}
                  {item.meta.maxRpm !== null ? ` · max ${item.meta.maxRpm.toLocaleString("de-DE")} RPM` : ""}
                </Text>
              </div>
              <Group gap={6} wrap="nowrap">
                <Button
                  size="compact-sm"
                  variant="light"
                  color="orange"
                  leftSection={<IconChartHistogram size={15} />}
                  onClick={() => open(item.id)}
                >
                  Öffnen
                </Button>
                <Tooltip label="Aus Historie entfernen">
                  <ActionIcon variant="subtle" color="red" onClick={() => remove(item.id)} aria-label="Entfernen">
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
