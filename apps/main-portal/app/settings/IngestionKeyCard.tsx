"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  CopyButton,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconCheck, IconCopy, IconRobot, IconPlus, IconTrash } from "@tabler/icons-react";
import type { IngestionKeySummary } from "@/app/lib/ingestion-key-actions";
import { createIngestionKey, revokeIngestionKey } from "@/app/lib/ingestion-key-actions";

const dateFormatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

const expiryOptions = [
  { value: "0", label: "Läuft nie ab" },
  { value: "90", label: "90 Tage" },
  { value: "365", label: "1 Jahr" },
];

export function IngestionKeyCard({ keys }: { keys: IngestionKeySummary[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createIngestionKey(name.trim(), Number(expiry) || null);
      if (result.success) {
        setCreatedKey(result.key);
        setName("");
        setExpiry("0");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function revoke(id: string, keyName: string) {
    if (!window.confirm(`Key „${keyName}" widerrufen? Automatische Importe damit verlieren sofort den Zugriff.`)) {
      return;
    }
    startTransition(async () => {
      const result = await revokeIngestionKey(id);
      if (result.success) {
        notifications.show({ color: "green", icon: <IconCheck size={16} />, message: "Key widerrufen." });
        router.refresh();
      } else {
        notifications.show({ color: "red", icon: <IconAlertCircle size={16} />, message: result.error ?? "Fehler." });
      }
    });
  }

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm">
        <IconRobot size={18} stroke={1.6} />
        <Title order={4}>Automatische Log-Ingestion · API-Keys</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Keys erlauben Home Assistant, cURL oder Sync-Skripten den automatischen Log-Upload an{" "}
        <Code>POST /api/v1/logs/ingest</Code> per <Code>X-API-Key</Code>-Header — ohne Web-Login.
      </Text>

      {keys.length > 0 && (
        <Table verticalSpacing="xs" fz="sm" mb="md">
          <TableThead>
            <TableTr>
              <TableTh>Name</TableTh>
              <TableTh>Erstellt</TableTh>
              <TableTh>Zuletzt genutzt</TableTh>
              <TableTh>Status</TableTh>
              <TableTh />
            </TableTr>
          </TableThead>
          <TableTbody>
            {keys.map((key) => {
              const expired = key.expiresAt && key.expiresAt.getTime() < now;
              const inactive = key.revoked || expired;
              return (
                <TableTr key={key.id}>
                  <TableTd>{key.name}</TableTd>
                  <TableTd>{dateFormatter.format(key.createdAt)}</TableTd>
                  <TableTd>{key.lastUsedAt ? dateFormatter.format(key.lastUsedAt) : "—"}</TableTd>
                  <TableTd>
                    <Badge size="sm" variant="light" color={inactive ? "red" : "green"}>
                      {key.revoked ? "widerrufen" : expired ? "abgelaufen" : "aktiv"}
                    </Badge>
                  </TableTd>
                  <TableTd>
                    {!key.revoked && (
                      <Tooltip label="Widerrufen">
                        <ActionIcon variant="subtle" color="red" onClick={() => revoke(key.id, key.name)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </TableTd>
                </TableTr>
              );
            })}
          </TableTbody>
        </Table>
      )}

      <Title order={6} mb="xs">
        Neuen Key erstellen
      </Title>
      <Group align="flex-end" gap="sm" wrap="wrap">
        <TextInput
          label="Name"
          placeholder="z. B. Home Assistant Watch-Folder"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <Select label="Gültigkeit" data={expiryOptions} value={expiry} onChange={(value) => setExpiry(value ?? "0")} allowDeselect={false} w={150} />
        <Button color="slate" leftSection={<IconPlus size={16} />} loading={isPending} disabled={!name.trim()} onClick={create}>
          Erstellen
        </Button>
      </Group>
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light" mt="sm">
          {error}
        </Alert>
      )}

      <Modal opened={createdKey !== null} onClose={() => setCreatedKey(null)} title="API-Key erstellt" centered size="lg">
        <Stack gap="sm">
          <Alert color="yellow" icon={<IconAlertCircle size={16} />} variant="light">
            Kopiere den Key jetzt — er wird <strong>nur dieses eine Mal</strong> angezeigt.
          </Alert>
          <Group gap="xs" wrap="nowrap">
            <Code block style={{ flex: 1, wordBreak: "break-all" }}>
              {createdKey}
            </Code>
            <CopyButton value={createdKey ?? ""}>
              {({ copied, copy }) => (
                <Button color={copied ? "green" : "slate"} leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />} onClick={copy}>
                  {copied ? "Kopiert" : "Kopieren"}
                </Button>
              )}
            </CopyButton>
          </Group>
          <Text size="xs" c="dimmed">
            Verwendung: <Code>curl -H &quot;X-API-Key: {"<key>"}&quot; -F file=@log.csv …/api/v1/logs/ingest</Code>
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreatedKey(null)}>
              Fertig
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
