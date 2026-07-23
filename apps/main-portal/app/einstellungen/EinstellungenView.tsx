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
  Loader,
  PasswordInput,
  Progress,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconCircle,
  IconCircleCheck,
  IconCircleX,
  IconExternalLink,
  IconRefresh,
  IconRocket,
} from "@tabler/icons-react";
import type { LocalCommitInfo, UpdateCheckResult } from "@zaehlwerk/updater";
import type { listLocations } from "../lib/zaehler-actions";
import { createLocationAction } from "../lib/location-actions";
import { initialActionState } from "../lib/action-state";

type LocationList = Awaited<ReturnType<typeof listLocations>>;

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
  const [state, formAction, pending] = useActionState(createLocationAction, initialActionState);
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

// Fixed checklist shown during an update; `step` in the phase is the index of
// the currently-active entry.
const UPDATE_STEPS = [
  "Update angefordert",
  "Neuer Code geholt (git pull)",
  "Neue Version wird gebaut",
  "Anwendung startet neu",
  "Erfolgreich – neue Version läuft",
];

type UpdatePhase =
  | { kind: "idle" }
  | { kind: "running"; step: number; message: string }
  | { kind: "restarting" }
  | { kind: "success" }
  | { kind: "failed"; step: number; message: string };

/** Maps the server's update-status stage to the active checklist index. */
function stageToStep(stage: string): number {
  switch (stage) {
    case "started":
    case "pulling":
      return 1;
    case "building":
      return 2;
    default:
      return 1;
  }
}

function activeStep(phase: UpdatePhase): number {
  switch (phase.kind) {
    case "running":
      return phase.step;
    case "restarting":
      return 3;
    case "success":
      return UPDATE_STEPS.length;
    case "failed":
      return phase.step;
    default:
      return 0;
  }
}

function UpdateProgress({ phase }: { phase: UpdatePhase }) {
  const active = activeStep(phase);
  const failed = phase.kind === "failed";
  const success = phase.kind === "success";
  const percent = success ? 100 : Math.round((active / UPDATE_STEPS.length) * 100);

  return (
    <Stack gap="sm">
      <Progress
        value={percent}
        color={failed ? "red" : success ? "green" : "slate"}
        animated={!failed && !success}
        striped={!failed && !success}
        radius="sm"
      />
      <Stack gap={6}>
        {UPDATE_STEPS.map((label, index) => {
          const isDone = index < active;
          const isActiveStep = index === active && !success;
          const isFailedStep = failed && index === active;
          return (
            <Group key={label} gap="xs" wrap="nowrap">
              {isFailedStep ? (
                <IconCircleX size={18} color="var(--mantine-color-red-6)" />
              ) : isDone ? (
                <IconCircleCheck size={18} color="var(--mantine-color-green-6)" />
              ) : isActiveStep ? (
                <Loader size={14} color="slate" />
              ) : (
                <IconCircle size={18} color="var(--mantine-color-gray-4)" />
              )}
              <Text size="sm" c={isDone || isActiveStep || isFailedStep ? undefined : "dimmed"} fw={isActiveStep ? 600 : 400}>
                {label}
              </Text>
            </Group>
          );
        })}
      </Stack>
      {phase.kind === "running" && phase.message && (
        <Text size="xs" c="dimmed">
          {phase.message}
        </Text>
      )}
      {phase.kind === "restarting" && (
        <Text size="xs" c="dimmed">
          Der Server wird neu gestartet — die Seite verbindet sich automatisch neu…
        </Text>
      )}
    </Stack>
  );
}

function UpdateSettingsCard({ versionInfo }: { versionInfo: LocalCommitInfo | null }) {
  const [checkState, setCheckState] = useState<CheckState>({ status: "idle" });
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const [token, setToken] = useState("");

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStepRef = useRef(1);
  const sawBuildingRef = useRef(false);
  const restartStartRef = useRef(0);

  function stopPolling() {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }

  // Clear any pending timer if the component unmounts mid-update.
  useEffect(() => stopPolling, []);

  async function pollStatus() {
    try {
      const response = await fetch("/api/update/status", { cache: "no-store" });
      const data = await response.json();
      if (data.stage === "failed") {
        setPhase({ kind: "failed", step: lastStepRef.current, message: data.message ?? "Update fehlgeschlagen." });
        stopPolling();
        return;
      }
      if (data.stage === "done") {
        setPhase({ kind: "success" });
        stopPolling();
        return;
      }
      if (data.stage === "building") sawBuildingRef.current = true;
      if (data.stage && data.stage !== "idle") {
        const step = stageToStep(data.stage);
        lastStepRef.current = step;
        setPhase({ kind: "running", step, message: data.message ?? "" });
      }
      pollRef.current = setTimeout(pollStatus, 2000);
    } catch {
      // Connection lost. If we already reached the build stage, the container
      // is being torn down and recreated — switch to waiting for it to return.
      if (sawBuildingRef.current) {
        enterRestarting();
      } else {
        pollRef.current = setTimeout(pollStatus, 2000);
      }
    }
  }

  function enterRestarting() {
    lastStepRef.current = 3;
    restartStartRef.current = Date.now();
    setPhase({ kind: "restarting" });
    pollRef.current = setTimeout(pollRestart, 3000);
  }

  async function pollRestart() {
    try {
      const response = await fetch("/api/update/check", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        if (data.updateAvailable === false) {
          setPhase({ kind: "success" });
          setCheckState({ status: "done", result: data as UpdateCheckResult });
          stopPolling();
          return;
        }
      }
    } catch {
      // still restarting
    }
    if (Date.now() - restartStartRef.current > 5 * 60_000) {
      setPhase({
        kind: "failed",
        step: 3,
        message: "Neustart dauert ungewöhnlich lange. Bitte /data/update.log auf dem Server prüfen.",
      });
      stopPolling();
      return;
    }
    pollRef.current = setTimeout(pollRestart, 3000);
  }

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

  function handleTrigger() {
    stopPolling();
    sawBuildingRef.current = false;
    lastStepRef.current = 1;
    setPhase({ kind: "running", step: 1, message: "Update wird gestartet…" });

    void (async () => {
      try {
        const response = await fetch("/api/update/trigger", {
          method: "POST",
          headers: { "x-update-token": token },
        });
        const data = await response.json();
        if (!response.ok) {
          setPhase({ kind: "failed", step: 0, message: data.error ?? "Update konnte nicht gestartet werden." });
          return;
        }
        pollRef.current = setTimeout(pollStatus, 1500);
      } catch {
        setPhase({ kind: "failed", step: 0, message: "Update konnte nicht gestartet werden (Netzwerkfehler)." });
      }
    })();
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

          {phase.kind === "idle" && (
            <>
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
                disabled={!token}
                onClick={handleTrigger}
              >
                Update jetzt starten (git pull + Rebuild)
              </Button>
            </>
          )}

          {phase.kind !== "idle" && <UpdateProgress phase={phase} />}

          {phase.kind === "success" && (
            <Alert color="green" icon={<IconCheck size={16} />} variant="light">
              Update erfolgreich abgeschlossen — die App läuft jetzt auf der neuen Version.
            </Alert>
          )}
          {phase.kind === "failed" && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
              {phase.message}
              <Text size="xs" mt={4}>
                Vollständiges Protokoll auf dem Server:{" "}
                <Code>docker compose -f docker-compose.prod.yml exec main-portal cat /data/update.log</Code>
              </Text>
            </Alert>
          )}
        </Stack>
      )}
    </Card>
  );
}
