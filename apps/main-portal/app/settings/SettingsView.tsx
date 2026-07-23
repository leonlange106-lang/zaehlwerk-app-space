"use client";

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  PasswordInput,
  Progress,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCircle,
  IconCircleCheck,
  IconCircleX,
  IconExternalLink,
  IconRefresh,
  IconRocket,
  IconTerminal2,
} from "@tabler/icons-react";
import classes from "./SettingsView.module.css";
import type { LocalCommitInfo, UpdateCheckResult } from "@zaehlwerk/updater";
import type { SessionUser } from "@/app/lib/auth-helpers";
import type { AppUser } from "@/app/lib/user-actions";
import type { ApiTokenSummary } from "@/app/lib/api-token-actions";
import type { AuditEvent } from "@/app/lib/audit";
import type { SnapshotFile } from "@/app/lib/backup-engine";
import type { DatabaseStats } from "@/app/lib/db-maintenance";
import type { BackupPolicy } from "@/app/lib/settings";
import { SystemBackupCard } from "./SystemBackupCard";
import { UserManagementCard } from "./UserManagementCard";
import { SecurityCard } from "./SecurityCard";
import { ApiTokenCard } from "./ApiTokenCard";
import { BackupPolicyCard } from "./BackupPolicyCard";
import { DatabaseMaintenanceCard } from "./DatabaseMaintenanceCard";
import { AuditLogCard } from "./AuditLogCard";

export type GovernanceData = {
  policy: BackupPolicy;
  snapshots: SnapshotFile[];
  dbStats: DatabaseStats;
  auditEvents: AuditEvent[];
};

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function SettingsView({
  versionInfo,
  currentUser,
  users,
  twoFactorEnabled,
  apiTokens,
  governance,
}: {
  versionInfo: LocalCommitInfo | null;
  currentUser: SessionUser | null;
  users: AppUser[];
  twoFactorEnabled: boolean;
  apiTokens: ApiTokenSummary[];
  governance: GovernanceData | null;
}) {
  const isAdmin = currentUser?.role === "ADMIN";

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Plattform-Einstellungen</Title>
        <Text c="dimmed" size="sm">
          System & Konten: Sicherheit, Benutzer, API-Zugriff, Backups und Updates. App-spezifische
          Optionen findest du in den jeweiligen App-Einstellungen.
        </Text>
      </div>

      {currentUser && <SecurityCard twoFactorEnabled={twoFactorEnabled} />}
      {currentUser && <ApiTokenCard tokens={apiTokens} />}
      {isAdmin && currentUser && <UserManagementCard users={users} currentUserId={currentUser.id} />}
      <SystemBackupCard />
      {isAdmin && governance && (
        <>
          <BackupPolicyCard policy={governance.policy} snapshots={governance.snapshots} />
          <DatabaseMaintenanceCard stats={governance.dbStats} />
          <AuditLogCard events={governance.auditEvents} />
        </>
      )}
      <UpdateSettingsCard versionInfo={versionInfo} />
    </Stack>
  );
}

type CheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; result: UpdateCheckResult };

// The concrete actions of an update, in order. The server reports a matching
// `stage`; everything before the active stage is shown as done. The live log
// below carries the real detail — these are just the milestones.
const UPDATE_STEPS = [
  "Neuer Code geholt (git pull)",
  "Neue Version gebaut",
  "Datenbank migriert",
  "Anwendung neu gestartet",
];

// Server stage → index of the currently-active step. `done` = all complete.
const STAGE_INDEX: Record<string, number> = {
  started: 0,
  pulling: 0,
  building: 1,
  migrating: 2,
  restarting: 3,
  done: UPDATE_STEPS.length,
  failed: 0,
};

function stageIndex(stage: string): number {
  return STAGE_INDEX[stage] ?? 0;
}

type UpdatePhase =
  | { kind: "idle" }
  | { kind: "running"; stage: string; message: string }
  | { kind: "success" }
  | { kind: "failed"; stage: string; message: string };

function UpdateProgress({ phase }: { phase: UpdatePhase }) {
  const success = phase.kind === "success";
  const failed = phase.kind === "failed";
  const active =
    success
      ? UPDATE_STEPS.length
      : phase.kind === "running" || phase.kind === "failed"
        ? stageIndex(phase.stage)
        : 0;

  return (
    <Stack gap="sm">
      <Progress
        value={success ? 100 : Math.round((active / UPDATE_STEPS.length) * 100)}
        color={failed ? "red" : success ? "green" : "slate"}
        animated={!failed && !success}
        striped={!failed && !success}
        radius="sm"
      />
      <Stack gap={6}>
        {UPDATE_STEPS.map((label, index) => {
          const isDone = index < active;
          const isActiveStep = index === active && !success && !failed;
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
      {phase.kind === "running" && (
        <Text size="xs" c="dimmed">
          {phase.message || "…"}
          {phase.stage === "building" && " — genauer Fortschritt im Live-Log unten."}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Read-only live tail of the server's /data/update.log. While an update is
 * `active` it re-fetches every 1.5s; the log lives on the persistent volume, so
 * a failed fetch during the container restart is transient and the full log
 * reappears once the new container answers.
 */
function LiveUpdateLog({ active }: { active: boolean }) {
  const [text, setText] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchLog() {
      try {
        const response = await fetch("/api/update/log", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const body = await response.text();
        if (!cancelled) setText(body);
      } catch {
        // Server is likely being recreated mid-update — keep the last content
        // and let the next tick pick the log back up.
      }
    }
    fetchLog();
    if (!active) return () => {
      cancelled = true;
    };
    const id = setInterval(fetchLog, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  // Stick to the bottom as new lines stream in.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight });
  }, [text]);

  return (
    <ScrollArea h={300} viewportRef={viewportRef} className={classes.logScroll} type="auto">
      <pre className={classes.logPre}>
        {text ||
          "Noch keine Log-Ausgabe. Sobald ein Update läuft, erscheint hier live das komplette Server-Protokoll (git pull, Migration, Build, Neustart)."}
      </pre>
    </ScrollArea>
  );
}

function UpdateSettingsCard({ versionInfo }: { versionInfo: LocalCommitInfo | null }) {
  const [checkState, setCheckState] = useState<CheckState>({ status: "idle" });
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const [token, setToken] = useState("");
  const [tokenRequired, setTokenRequired] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStageRef = useRef("started");
  const startRef = useRef(0);

  function stopPolling() {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }

  // On mount: learn whether the server requires a token, and restore a
  // remembered one so it isn't re-typed on every update. All setState happens
  // after the await boundary (never synchronously inside the effect body).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let required = false;
      try {
        const response = await fetch("/api/update/trigger", { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          required = Boolean(data.tokenRequired);
        }
      } catch {
        // ignore — a POST will still 401 if a token turns out to be required
      }
      if (cancelled) return;
      setTokenRequired(required);
      try {
        const saved = window.localStorage.getItem("zaehlwerk.updateToken");
        if (saved) setToken(saved);
      } catch {
        // localStorage unavailable (private mode) — just skip remembering
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Clear any pending timer if the component unmounts mid-update.
  useEffect(() => stopPolling, []);

  // Single source of truth: poll the authoritative status file. The detached
  // deployer writes "done"/"failed" once the swap is really finished, so we no
  // longer have to guess success from a dropped connection. A fetch failure
  // here is almost always the brief mid-update recreate — we keep retrying.
  function finishSuccess() {
    stopPolling();
    setPhase({ kind: "success" });
    // Reload so the version badge + "current version" show the new build. If the
    // session was lost across the swap, the reload lands on /login — also fine.
    setTimeout(() => window.location.reload(), 1500);
  }

  async function pollStatus() {
    try {
      const response = await fetch("/api/update/status", { cache: "no-store" });
      // The new build answering with 401/403 means the swap finished and the app
      // is back — just under auth now (e.g. the first update onto the auth
      // build, where this polling browser has no session). Treat as done.
      if (response.status === 401 || response.status === 403) {
        finishSuccess();
        return;
      }
      const data = await response.json();
      if (data.stage === "failed") {
        setPhase({ kind: "failed", stage: lastStageRef.current, message: data.message ?? "Update fehlgeschlagen." });
        stopPolling();
        return;
      }
      if (data.stage === "done") {
        finishSuccess();
        return;
      }
      if (data.stage && data.stage !== "idle") {
        lastStageRef.current = data.stage;
        setPhase({ kind: "running", stage: data.stage, message: data.message ?? "" });
      }
      pollRef.current = setTimeout(pollStatus, 1500);
    } catch {
      // Server unreachable — the recreate is in flight. Keep waiting; the new
      // container serves "done" shortly. Give up only after a generous cap.
      if (Date.now() - startRef.current > 12 * 60_000) {
        setPhase({
          kind: "failed",
          stage: lastStageRef.current,
          message: "Zeitüberschreitung — bitte das Server-Log unten prüfen.",
        });
        stopPolling();
        return;
      }
      pollRef.current = setTimeout(pollStatus, 2000);
    }
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
    lastStageRef.current = "started";
    startRef.current = Date.now();
    setLogOpen(true);
    setPhase({ kind: "running", stage: "started", message: "Update wird gestartet…" });

    void (async () => {
      try {
        const response = await fetch("/api/update/trigger", {
          method: "POST",
          headers: token ? { "x-update-token": token } : undefined,
        });
        const data = await response.json();
        if (!response.ok) {
          setPhase({ kind: "failed", stage: "started", message: data.error ?? "Update konnte nicht gestartet werden." });
          return;
        }
        if (token) {
          try {
            window.localStorage.setItem("zaehlwerk.updateToken", token);
          } catch {
            // ignore
          }
        }
        pollRef.current = setTimeout(pollStatus, 1500);
      } catch {
        setPhase({ kind: "failed", stage: "started", message: "Update konnte nicht gestartet werden (Netzwerkfehler)." });
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
              {tokenRequired && (
                <PasswordInput
                  label="Update-Token"
                  description="Nur nötig, weil UPDATE_TRIGGER_TOKEN auf dem Server gesetzt ist. Wird im Browser gemerkt — leer lassen und die Variable entfernen, wenn du keinen Schutz brauchst."
                  placeholder="Token eingeben"
                  value={token}
                  onChange={(event) => setToken(event.currentTarget.value)}
                />
              )}
              <Button
                color="slate"
                leftSection={<IconRocket size={16} />}
                disabled={tokenRequired && !token}
                onClick={handleTrigger}
              >
                Update jetzt starten (git pull + Rebuild)
              </Button>
            </>
          )}

          {phase.kind !== "idle" && <UpdateProgress phase={phase} />}

          {phase.kind === "running" && phase.stage === "restarting" && (
            <Button
              variant="light"
              color="slate"
              size="xs"
              leftSection={<IconRefresh size={14} />}
              onClick={() => window.location.reload()}
            >
              Lädt nicht automatisch? Jetzt neu laden
            </Button>
          )}

          {phase.kind === "success" && (
            <Alert color="green" icon={<IconCheck size={16} />} variant="light">
              <Group justify="space-between" align="center" wrap="nowrap">
                <Text size="sm">Update abgeschlossen — die Seite lädt neu…</Text>
                <Button
                  size="xs"
                  color="green"
                  variant="light"
                  leftSection={<IconRefresh size={14} />}
                  onClick={() => window.location.reload()}
                >
                  Jetzt neu laden
                </Button>
              </Group>
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

      <Group justify="space-between" align="center" mt="md" pt="md" className={classes.logDivider}>
        <Group gap={6}>
          <IconTerminal2 size={15} />
          <Text size="sm" fw={600}>
            Server-Log (live)
          </Text>
          {phase.kind === "running" && <Loader size={12} color="slate" />}
        </Group>
        <Button
          variant="subtle"
          color="slate"
          size="xs"
          rightSection={logOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          onClick={() => setLogOpen((open) => !open)}
        >
          {logOpen ? "Ausblenden" : "Anzeigen"}
        </Button>
      </Group>
      {logOpen && <LiveUpdateLog active={phase.kind === "running"} />}
    </Card>
  );
}
