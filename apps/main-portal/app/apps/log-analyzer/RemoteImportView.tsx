"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Group,
  List,
  ListItem,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCloudDownload, IconLink, IconWorldDownload } from "@tabler/icons-react";
import { parseShareLink } from "./lib/mgflasher";
import { addToHistory, newLogId, setActiveLog, type StoredLog } from "./lib/log-store";
import type { ParsedLog } from "./lib/types";

// Import a log by MGflasher share link. The URL is validated client-side for
// instant feedback, then the server route (`/api/apps/log-analyzer/fetch-remote`)
// does the authoritative validation + fetch + parse. On success we hand the
// parsed log to the analyzer via the session store and navigate there.

export function RemoteImportView() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientCheck = parseShareLink(url);
  const canSubmit = url.trim() !== "" && clientCheck.ok && !busy;
  const formatError = url.trim() !== "" && !clientCheck.ok ? clientCheck.reason : undefined;

  async function handleImport() {
    setError(null);
    const check = parseShareLink(url);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/apps/log-analyzer/fetch-remote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        source?: string;
        log?: ParsedLog;
      };
      if (!res.ok || !json.ok || !json.log) {
        setError(json.error ?? `Import fehlgeschlagen (HTTP ${res.status}).`);
        return;
      }
      const entry: StoredLog = {
        id: newLogId(),
        name: `Log ${check.uuid.slice(0, 8)}`,
        source: "remote",
        sourceUrl: json.source ?? check.canonicalUrl,
        importedAt: Date.now(),
        log: json.log,
      };
      addToHistory(entry);
      setActiveLog(entry);
      router.push("/apps/log-analyzer");
    } catch {
      setError("Netzwerkfehler beim Import. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="lg" maw={680} mx="auto">
      <Group gap="md">
        <ThemeIcon variant="light" color="blue" radius="md" size={44}>
          <IconWorldDownload size={24} stroke={1.5} />
        </ThemeIcon>
        <div>
          <Title order={2}>Remote-Import</Title>
          <Text c="dimmed" size="sm">
            Ein Log direkt über einen MGflasher-Share-Link laden.
          </Text>
        </div>
      </Group>

      <Card withBorder radius="md" p="lg">
        <Stack gap="md">
          <TextInput
            label="MGflasher Share-Link"
            placeholder="https://logs.mgflasher.com/log/…"
            leftSection={<IconLink size={16} />}
            value={url}
            onChange={(e) => {
              setUrl(e.currentTarget.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) void handleImport();
            }}
            error={formatError}
            data-testid="remote-url"
          />

          {error && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              {error}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button
              color="blue"
              leftSection={<IconCloudDownload size={16} />}
              loading={busy}
              disabled={!canSubmit}
              onClick={handleImport}
            >
              Prüfen &amp; Importieren
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder radius="md" p="lg" bg="var(--mantine-color-body)">
        <Text size="sm" fw={600} mb="xs">
          Hinweise
        </Text>
        <List size="sm" spacing={6} c="dimmed">
          <ListItem>
            Es werden ausschließlich Links von <b>logs.mgflasher.com</b> akzeptiert.
          </ListItem>
          <ListItem>Der Abruf erfolgt serverseitig; Zugriff nur für freigeschaltete Nutzer.</ListItem>
          <ListItem>Nach dem Import öffnet sich das Log direkt im Analyzer.</ListItem>
        </List>
      </Card>
    </Stack>
  );
}
