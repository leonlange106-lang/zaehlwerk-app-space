"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ActionIcon,
  Alert,
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
import { IconAlertCircle, IconCheck, IconCopy, IconKey, IconPlus, IconTrash } from "@tabler/icons-react";
import type { ApiTokenSummary } from "../lib/api-token-actions";
import { createApiToken, deleteApiToken } from "../lib/api-token-actions";

const dateFormatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

const expiryOptions = [
  { value: "0", label: "Läuft nie ab" },
  { value: "30", label: "30 Tage" },
  { value: "90", label: "90 Tage" },
  { value: "365", label: "1 Jahr" },
];

export function ApiTokenCard({ tokens }: { tokens: ApiTokenSummary[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  // Snapshot "now" once (lazy init) — calling Date.now() during render is impure.
  const [now] = useState(() => Date.now());

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createApiToken(name.trim(), Number(expiry) || null);
      if (result.success) {
        setCreatedToken(result.token);
        setName("");
        setExpiry("0");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove(id: string, tokenName: string) {
    if (!window.confirm(`Token „${tokenName}" wirklich löschen? Skripte, die ihn nutzen, verlieren den Zugriff.`)) {
      return;
    }
    startTransition(async () => {
      const result = await deleteApiToken(id);
      if (result.success) {
        notifications.show({ color: "green", icon: <IconCheck size={16} />, message: "Token gelöscht." });
        router.refresh();
      } else {
        notifications.show({ color: "red", icon: <IconAlertCircle size={16} />, message: result.error ?? "Fehler." });
      }
    });
  }

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm">
        <IconKey size={18} stroke={1.6} />
        <Title order={4}>API-Zugriff · Personal Access Tokens</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Tokens erlauben externen Skripten / Smart-Home-Geräten (Home Assistant, ESP32) den Zugriff auf die
        Export- und Backup-Endpunkte per <Code>Authorization: Bearer zw_pat_…</Code> — ohne Web-Login.
      </Text>

      {tokens.length > 0 && (
        <Table verticalSpacing="xs" fz="sm" mb="md">
          <TableThead>
            <TableTr>
              <TableTh>Name</TableTh>
              <TableTh>Erstellt</TableTh>
              <TableTh>Zuletzt genutzt</TableTh>
              <TableTh>Läuft ab</TableTh>
              <TableTh />
            </TableTr>
          </TableThead>
          <TableTbody>
            {tokens.map((token) => {
              const expired = token.expiresAt && token.expiresAt.getTime() < now;
              return (
                <TableTr key={token.id}>
                  <TableTd>{token.name}</TableTd>
                  <TableTd>{dateFormatter.format(token.createdAt)}</TableTd>
                  <TableTd>{token.lastUsedAt ? dateFormatter.format(token.lastUsedAt) : "—"}</TableTd>
                  <TableTd>
                    {token.expiresAt ? (
                      <Text span size="sm" c={expired ? "red" : undefined}>
                        {dateFormatter.format(token.expiresAt)}
                        {expired ? " (abgelaufen)" : ""}
                      </Text>
                    ) : (
                      "—"
                    )}
                  </TableTd>
                  <TableTd>
                    <Tooltip label="Löschen / Widerrufen">
                      <ActionIcon variant="subtle" color="red" onClick={() => remove(token.id, token.name)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </TableTd>
                </TableTr>
              );
            })}
          </TableTbody>
        </Table>
      )}

      <Title order={6} mb="xs">
        Neuen Token erstellen
      </Title>
      <Group align="flex-end" gap="sm" wrap="wrap">
        <TextInput
          label="Name"
          placeholder="z. B. Home Assistant"
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

      {/* Show the plaintext token exactly once */}
      <Modal
        opened={createdToken !== null}
        onClose={() => setCreatedToken(null)}
        title="Token erstellt"
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Alert color="yellow" icon={<IconAlertCircle size={16} />} variant="light">
            Kopiere den Token jetzt — er wird <strong>nur dieses eine Mal</strong> angezeigt und kann danach nicht
            mehr eingesehen werden.
          </Alert>
          <Group gap="xs" wrap="nowrap">
            <Code block style={{ flex: 1, wordBreak: "break-all" }}>
              {createdToken}
            </Code>
            <CopyButton value={createdToken ?? ""}>
              {({ copied, copy }) => (
                <Button
                  color={copied ? "green" : "slate"}
                  leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  onClick={copy}
                >
                  {copied ? "Kopiert" : "Kopieren"}
                </Button>
              )}
            </CopyButton>
          </Group>
          <Text size="xs" c="dimmed">
            Verwendung: <Code>Authorization: Bearer {"<token>"}</Code>
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreatedToken(null)}>
              Fertig
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
