"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  List,
  ListItem,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconExternalLink,
  IconRefresh,
  IconRocket,
} from "@tabler/icons-react";
import type { LocalCommitInfo, UpdateCheckResult } from "@zaehlwerk/updater";
import type { listLocations } from "../lib/zaehler-actions";
import { createLocationAction } from "../lib/location-actions";

type LocationList = Awaited<ReturnType<typeof listLocations>>;

const initialState = { success: false, error: undefined };

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function EinstellungenView({
  locations,
  versionInfo,
}: {
  locations: LocationList;
  versionInfo: LocalCommitInfo | null;
}) {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Einstellungen</Title>
        <Text c="dimmed" size="sm">
          Standorte / Zählergruppen verwalten und System-Updates prüfen.
        </Text>
      </div>

      <LocationsCard locations={locations} />
      <UpdateSettingsCard versionInfo={versionInfo} />
    </Stack>
  );
}

function LocationsCard({ locations }: { locations: LocationList }) {
  const [state, formAction, pending] = useActionState(createLocationAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <Card withBorder radius="md" p="lg">
      <Title order={4} mb="sm">
        Standorte / Zählergruppen
      </Title>

      {locations.length === 0 ? (
        <Text size="sm" c="dimmed" mb="sm">
          Noch keine Standorte angelegt.
        </Text>
      ) : (
        <List spacing="xs" size="sm" mb="md">
          {locations.map((location) => (
            <ListItem key={location.id}>
              <Text span fw={600}>
                {location.name}
              </Text>
              {location.address && (
                <Text span c="dimmed">
                  {" "}
                  — {location.address}
                </Text>
              )}
            </ListItem>
          ))}
        </List>
      )}

      <form action={formAction} ref={formRef}>
        <Group align="flex-end" gap="sm" wrap="wrap">
          <TextInput name="name" label="Neuer Standort" placeholder="z. B. Nebengebäude" required style={{ flex: 1, minWidth: 200 }} />
          <TextInput name="address" label="Adresse (optional)" placeholder="Straße, Ort" style={{ flex: 1, minWidth: 200 }} />
          <Button type="submit" color="slate" loading={pending}>
            Hinzufügen
          </Button>
        </Group>
        {state.error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light" mt="sm">
            {state.error}
          </Alert>
        )}
        {state.success && (
          <Alert color="green" icon={<IconCheck size={16} />} variant="light" mt="sm">
            Standort wurde angelegt.
          </Alert>
        )}
      </form>
    </Card>
  );
}

type CheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; result: UpdateCheckResult };

type TriggerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done" };

function UpdateSettingsCard({ versionInfo }: { versionInfo: LocalCommitInfo | null }) {
  const [checkState, setCheckState] = useState<CheckState>({ status: "idle" });
  const [triggerState, setTriggerState] = useState<TriggerState>({ status: "idle" });
  const [token, setToken] = useState("");

  async function handleCheck() {
    setCheckState({ status: "loading" });
    try {
      const response = await fetch("/api/update/check");
      const data = await response.json();
      if (!response.ok) {
        setCheckState({ status: "error", message: data.error ?? "Prüfung fehlgeschlagen." });
        return;
      }
      setCheckState({ status: "done", result: data as UpdateCheckResult });
    } catch {
      setCheckState({ status: "error", message: "Prüfung fehlgeschlagen (Netzwerkfehler)." });
    }
  }

  async function handleTrigger() {
    setTriggerState({ status: "loading" });
    try {
      const response = await fetch("/api/update/trigger", {
        method: "POST",
        headers: { "x-update-token": token },
      });
      const data = await response.json();
      if (!response.ok) {
        setTriggerState({ status: "error", message: data.error ?? "Update konnte nicht gestartet werden." });
        return;
      }
      setTriggerState({ status: "done" });
    } catch {
      setTriggerState({ status: "error", message: "Update konnte nicht gestartet werden (Netzwerkfehler)." });
    }
  }

  const updateAvailable = checkState.status === "done" && checkState.result.updateAvailable;

  return (
    <Card withBorder radius="md" p="lg">
      <Title order={4} mb="sm">
        System-Update
      </Title>

      <Group justify="space-between" mb="md">
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Aktuelle Version
          </Text>
          {versionInfo ? (
            <Group gap="xs">
              <Code>{versionInfo.shortSha}</Code>
              <Badge variant="light" color="slate" size="sm">
                {versionInfo.branch}
              </Badge>
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              Kein Git-Repository gefunden (REPO_ROOT prüfen).
            </Text>
          )}
        </div>
        <Button
          variant="light"
          color="slate"
          leftSection={<IconRefresh size={16} />}
          loading={checkState.status === "loading"}
          onClick={handleCheck}
        >
          Nach Updates suchen
        </Button>
      </Group>

      {checkState.status === "error" && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light" mb="sm">
          {checkState.message}
        </Alert>
      )}

      {checkState.status === "done" && !updateAvailable && (
        <Alert color="green" icon={<IconCheck size={16} />} variant="light" mb="sm">
          Auf dem neuesten Stand ({checkState.result.branch} @ {checkState.result.currentShortSha}).
        </Alert>
      )}

      {checkState.status === "done" && updateAvailable && (
        <Stack gap="sm">
          <Alert color="yellow" icon={<IconRocket size={16} />} variant="light">
            <Text size="sm" fw={600}>
              Update verfügbar: {checkState.result.latestShortSha}
            </Text>
            <Text size="sm">{checkState.result.latestCommitMessage}</Text>
            <Text size="xs" c="dimmed">
              {checkState.result.latestCommitDate ? dateFormatter.format(new Date(checkState.result.latestCommitDate)) : ""}
            </Text>
            <Button
              component="a"
              href={checkState.result.latestCommitUrl}
              target="_blank"
              rel="noreferrer"
              variant="subtle"
              color="slate"
              size="xs"
              mt={4}
              rightSection={<IconExternalLink size={12} />}
              px={0}
            >
              Auf GitHub ansehen
            </Button>
          </Alert>

          <PasswordInput
            label="Update-Token"
            description="Muss mit UPDATE_TRIGGER_TOKEN auf dem Server übereinstimmen"
            placeholder="Token eingeben"
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
          />

          <Button
            color="slate"
            leftSection={<IconRocket size={16} />}
            disabled={!token || triggerState.status === "done"}
            loading={triggerState.status === "loading"}
            onClick={handleTrigger}
          >
            Update jetzt starten (git pull + Rebuild)
          </Button>

          {triggerState.status === "error" && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
              {triggerState.message}
            </Alert>
          )}
          {triggerState.status === "done" && (
            <Alert color="green" icon={<IconCheck size={16} />} variant="light">
              Update gestartet — der Server lädt in Kürze mit der neuen Version neu.
            </Alert>
          )}
        </Stack>
      )}
    </Card>
  );
}
