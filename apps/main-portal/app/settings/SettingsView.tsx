"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/app/components/ui/Badge";
import { Button, ButtonLink } from "@/app/components/ui/Button";
import { Field, PasswordInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import {
  Alert,
  Code,
  PageHeader,
  Progress,
  Spinner,
} from "@/app/components/ui/primitives";
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
import type { BackupPolicy, LogRetentionPolicy } from "@/app/lib/settings";
import { normalizeUpdateState, UPDATE_STEPS, type UpdateState } from "@/app/lib/update-status";
import { SystemBackupCard } from "./SystemBackupCard";
import { UserManagementCard } from "./UserManagementCard";
import { SecurityCard } from "./SecurityCard";
import { ApiTokenCard } from "./ApiTokenCard";
import { IngestionKeyCard } from "./IngestionKeyCard";
import type { IngestionKeySummary } from "@/app/lib/ingestion-key-actions";
import { BackupPolicyCard } from "./BackupPolicyCard";
import { DatabaseMaintenanceCard } from "./DatabaseMaintenanceCard";
import { AuditLogCard } from "./AuditLogCard";

export type GovernanceData = {
  policy: BackupPolicy;
  snapshots: SnapshotFile[];
  dbStats: DatabaseStats;
  auditEvents: AuditEvent[];
  logRetention: LogRetentionPolicy;
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
  ingestionKeys,
  governance,
}: {
  versionInfo: LocalCommitInfo | null;
  currentUser: SessionUser | null;
  users: AppUser[];
  twoFactorEnabled: boolean;
  apiTokens: ApiTokenSummary[];
  ingestionKeys: IngestionKeySummary[];
  governance: GovernanceData | null;
}) {
  const isAdmin = currentUser?.role === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plattform-Einstellungen"
        description="System & Konten: Sicherheit, Benutzer, API-Zugriff, Backups und Updates. App-spezifische Optionen findest du in den jeweiligen App-Einstellungen."
      />

      {currentUser && <SecurityCard twoFactorEnabled={twoFactorEnabled} />}
      {currentUser && <ApiTokenCard tokens={apiTokens} />}
      {isAdmin && <IngestionKeyCard keys={ingestionKeys} />}
      {isAdmin && currentUser && (
        <UserManagementCard users={users} currentUserId={currentUser.id} />
      )}
      {isAdmin && <SystemBackupCard />}
      {isAdmin && governance && (
        <>
          <BackupPolicyCard policy={governance.policy} snapshots={governance.snapshots} />
          <DatabaseMaintenanceCard
            stats={governance.dbStats}
            logRetention={governance.logRetention}
          />
          <AuditLogCard events={governance.auditEvents} />
        </>
      )}
      <UpdateSettingsCard versionInfo={versionInfo} />
    </div>
  );
}

type CheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; result: UpdateCheckResult };

/**
 * The progress stepper, driven entirely by the server-normalized {@link UpdateState}.
 * `failIndex` marks which step to flag on failure — the raw "failed" stage no
 * longer carries a step, so the client remembers the last running step instead.
 */
function UpdateProgress({ state, failIndex }: { state: UpdateState; failIndex: number }) {
  const steps = state.steps.length ? state.steps : [...UPDATE_STEPS];
  const success = state.status === "SUCCESS";
  const failed = state.status === "ERROR";
  const active = failed ? failIndex : state.stepIndex;

  return (
    <div className="flex flex-col gap-3">
      <Progress
        value={success ? 100 : state.progress}
        tone={failed ? "risk" : success ? "ok" : "accent"}
        label="Update-Fortschritt"
        data-testid="update-progress-bar"
      />
      <div className="flex flex-col gap-1.5">
        {steps.map((label, index) => {
          const isDone = index < active || success;
          const isActiveStep = index === active && !success && !failed;
          const isFailedStep = failed && index === active;
          return (
            <div key={label} className="flex items-center gap-2">
              {isFailedStep ? (
                <IconCircleX size={18} className="flex-none text-risk" />
              ) : isDone ? (
                <IconCircleCheck size={18} className="flex-none text-ok" />
              ) : isActiveStep ? (
                <Spinner size={14} label={`${label} läuft`} className="text-accent" />
              ) : (
                <IconCircle size={18} className="flex-none text-neutral" />
              )}
              <span
                className={`text-sm ${isActiveStep ? "font-semibold" : ""} ${
                  isDone || isActiveStep || isFailedStep ? "" : "text-dim"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      {state.status === "RUNNING" && (
        <p className="text-xs text-dim">
          {state.message || "…"}
          {state.stage === "building" && " — genauer Fortschritt im Live-Log unten."}
        </p>
      )}
    </div>
  );
}

/**
 * Read-only view of the server update log. The text is pushed in via SSE (part
 * of the broadcast state), so this component no longer fetches anything — it
 * just renders the latest tail and sticks to the bottom as new lines arrive.
 */
function UpdateLogView({ logs }: { logs: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight });
  }, [logs]);

  return (
    <div ref={viewportRef} className={classes.logScroll} style={{ height: 300, overflow: "auto" }}>
      <pre className={classes.logPre}>
        {logs ||
          "Noch keine Log-Ausgabe. Sobald ein Update läuft, erscheint hier live das komplette Server-Protokoll (git pull, Migration, Build, Neustart)."}
      </pre>
    </div>
  );
}

function UpdateSettingsCard({ versionInfo }: { versionInfo: LocalCommitInfo | null }) {
  const [checkState, setCheckState] = useState<CheckState>({ status: "idle" });
  const [token, setToken] = useState("");
  const [tokenRequired, setTokenRequired] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // The global, server-authoritative update state (from the initial fetch + SSE).
  const [state, setState] = useState<UpdateState | null>(null);
  // True once THIS session has witnessed a RUNNING state — so a stale "done"
  // left on disk from a past update never shows a success banner or triggers a
  // reload on a fresh page load.
  const [witnessedRunning, setWitnessedRunning] = useState(false);
  // The last RUNNING step index — where a subsequent failure is flagged in the
  // stepper (the raw "failed" stage carries no step). Kept in state for render
  // and mirrored to a ref for the SSE error handler.
  const [lastRunningStep, setLastRunningStep] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const sawRunningRef = useRef(false);
  const lastRunningIndexRef = useRef(0);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadingRef = useRef(false);

  const finishSuccess = useCallback(() => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    // Reload so the version badge shows the new build. If the session was lost
    // across the swap, the reload lands on /login — also fine.
    setTimeout(() => window.location.reload(), 1500);
  }, []);

  // Fold an incoming state into the UI. Terminal states only act (reload / show
  // failure) once we've actually seen the run go RUNNING in this session.
  const applyState = useCallback(
    (next: UpdateState) => {
      setState(next);
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      if (next.status === "RUNNING") {
        sawRunningRef.current = true;
        lastRunningIndexRef.current = next.stepIndex;
        setLastRunningStep(next.stepIndex);
        setWitnessedRunning(true);
        setLogOpen(true);
      } else if (next.status === "SUCCESS" && sawRunningRef.current) {
        finishSuccess();
      }
    },
    [finishSuccess],
  );

  // Open the shared SSE stream. Every settings session keeps one open, so a run
  // started from ANY client is broadcast here in realtime.
  const attachStream = useCallback(() => {
    if (esRef.current) return;
    let es: EventSource;
    try {
      es = new EventSource("/api/system/update/stream");
    } catch {
      return;
    }
    es.addEventListener("state", (event) => {
      try {
        applyState(JSON.parse((event as MessageEvent).data) as UpdateState);
      } catch {
        // ignore a malformed frame; the next one supersedes it
      }
    });
    es.onerror = () => {
      // EventSource auto-reconnects on a dropped connection. The one gap it can't
      // bridge is the mid-update container swap: if we're in the restart step and
      // the stream can't be re-established, fall back to a full reload onto the
      // new build (which may require re-auth — landing on /login is fine).
      if (!sawRunningRef.current || lastRunningIndexRef.current < 3) return;
      if (reloadTimerRef.current || reloadingRef.current) return;
      reloadTimerRef.current = setTimeout(() => window.location.reload(), 10_000);
    };
    esRef.current = es;
  }, [applyState]);

  // On mount: learn whether the server requires a token, and restore a
  // remembered one so it isn't re-typed on every update.
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

  // On mount/refresh: fetch the current global state (client persistency), then
  // attach the SSE stream so this session stays in sync with all others.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/system/update/state", { cache: "no-store" });
        if (response.ok && !cancelled) {
          applyState((await response.json()) as UpdateState);
        }
      } catch {
        // ignore — the stream below will deliver the state shortly
      }
      if (!cancelled) attachStream();
    })();
    return () => {
      cancelled = true;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, [applyState, attachStream]);

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
    attachStream();
    setLogOpen(true);
    // Optimistic RUNNING so the UI responds instantly; the SSE stream takes over
    // with the authoritative per-stage progress within ~1s.
    applyState(normalizeUpdateState({ stage: "started", message: "Update wird gestartet…" }, state?.logs ?? ""));

    void (async () => {
      try {
        const response = await fetch("/api/update/trigger", {
          method: "POST",
          headers: token ? { "x-update-token": token } : undefined,
        });
        const data = await response.json();
        if (!response.ok) {
          applyState(
            normalizeUpdateState(
              { stage: "failed", message: data.error ?? "Update konnte nicht gestartet werden." },
              state?.logs ?? "",
            ),
          );
          return;
        }
        if (token) {
          try {
            window.localStorage.setItem("zaehlwerk.updateToken", token);
          } catch {
            // ignore
          }
        }
        // Progress now arrives over SSE — nothing else to do here.
      } catch {
        applyState(
          normalizeUpdateState(
            { stage: "failed", message: "Update konnte nicht gestartet werden (Netzwerkfehler)." },
            state?.logs ?? "",
          ),
        );
      }
    })();
  }

  const updateAvailable = checkState.status === "done" && checkState.result.updateAvailable;
  const running = state?.status === "RUNNING";
  const succeeded = witnessedRunning && state?.status === "SUCCESS";
  const failed = witnessedRunning && state?.status === "ERROR";
  // The progress block is global: it appears for anyone whose session witnessed
  // the run, independent of whether they clicked "check for updates".
  const showProgress = Boolean(running || succeeded || failed);
  const logs = state?.logs ?? "";

  return (
    <Panel title="System-Update">
      {showProgress && state && (
        <Alert
          className="mb-5"
          tone={failed ? "risk" : succeeded ? "ok" : "info"}
          role={failed ? "alert" : "status"}
          icon={
            running ? (
              <Spinner size={16} label="Update läuft" />
            ) : succeeded ? (
              <IconCircleCheck size={18} />
            ) : (
              <IconCircleX size={18} />
            )
          }
          title={
            running
              ? "System-Update läuft…"
              : succeeded
                ? "Update abgeschlossen"
                : "Update fehlgeschlagen"
          }
        >
          <div className="flex flex-col gap-3" data-testid="update-progress">
            <p className="text-xs">
              {running
                ? "Läuft global auf dem Server — der Fortschritt ist in allen geöffneten Sitzungen sichtbar und überdauert einen Reload."
                : succeeded
                  ? "Die Seite lädt neu…"
                  : state.error}
            </p>

            <UpdateProgress state={state} failIndex={lastRunningStep} />

            {running && state.stage === "restarting" && (
              <Button size="sm" onClick={() => window.location.reload()}>
                <IconRefresh size={14} />
                Lädt nicht automatisch? Jetzt neu laden
              </Button>
            )}

            {succeeded && (
              <div className="flex justify-end">
                <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
                  <IconRefresh size={14} />
                  Jetzt neu laden
                </Button>
              </div>
            )}

            {failed && (
              <p className="text-xs">
                Vollständiges Protokoll auf dem Server:{" "}
                <Code>
                  docker compose -f docker-compose.prod.yml exec main-portal cat /data/update.log
                </Code>
              </p>
            )}
          </div>
        </Alert>
      )}

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="legend-label">Aktuelle Version</p>
          {versionInfo ? (
            <span className="mt-1 flex items-center gap-2">
              <Code>{versionInfo.shortSha}</Code>
              <Badge>{versionInfo.branch}</Badge>
            </span>
          ) : (
            <p className="mt-1 text-sm text-dim">
              Kein Git-Repository gefunden (REPO_ROOT prüfen).
            </p>
          )}
        </div>
        <Button disabled={checkState.status === "loading"} onClick={handleCheck}>
          <IconRefresh size={16} />
          {checkState.status === "loading" ? "Wird geprüft…" : "Nach Updates suchen"}
        </Button>
      </div>

      {checkState.status === "error" && (
        <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />} className="mb-3">
          {checkState.message}
        </Alert>
      )}

      {checkState.status === "done" && !updateAvailable && (
        <Alert tone="ok" icon={<IconCheck size={16} />} className="mb-3">
          Auf dem neuesten Stand ({checkState.result.branch} @ {checkState.result.currentShortSha}).
        </Alert>
      )}

      {checkState.status === "done" && updateAvailable && (
        <div className="flex flex-col gap-3">
          <Alert tone="watch" icon={<IconRocket size={16} />}>
            <p className="text-sm font-semibold text-ink">
              Update verfügbar: {checkState.result.latestShortSha}
            </p>
            <p className="text-sm">{checkState.result.latestCommitMessage}</p>
            <p className="text-xs">
              {checkState.result.latestCommitDate
                ? dateFormatter.format(new Date(checkState.result.latestCommitDate))
                : ""}
            </p>
            <ButtonLink
              href={checkState.result.latestCommitUrl}
              target="_blank"
              rel="noreferrer"
              variant="ghost"
              size="sm"
              className="mt-1 px-0"
            >
              Auf GitHub ansehen
              <IconExternalLink size={12} />
            </ButtonLink>
          </Alert>

          {!running && (
            <>
              {tokenRequired && (
                <Field
                  label="Update-Token"
                  description="Nur nötig, weil UPDATE_TRIGGER_TOKEN auf dem Server gesetzt ist. Wird im Browser gemerkt — leer lassen und die Variable entfernen, wenn du keinen Schutz brauchst."
                >
                  {({ id, describedBy }) => (
                    <PasswordInput
                      id={id}
                      aria-describedby={describedBy}
                      placeholder="Token eingeben"
                      value={token}
                      onChange={(event) => setToken(event.currentTarget.value)}
                    />
                  )}
                </Field>
              )}
              <Button
                variant="primary"
                className="w-fit"
                disabled={tokenRequired && !token}
                onClick={handleTrigger}
              >
                <IconRocket size={16} />
                {failed ? "Update erneut starten" : "Update jetzt starten (git pull + Rebuild)"}
              </Button>
            </>
          )}
        </div>
      )}

      <div
        className={`mt-5 flex items-center justify-between gap-3 pt-5 ${classes.logDivider}`}
      >
        <span className="flex items-center gap-1.5">
          <IconTerminal2 size={15} className="flex-none text-dim" />
          <span className="text-sm font-semibold">Server-Log (live)</span>
          {running && <Spinner size={12} label="Update läuft" className="text-accent" />}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setLogOpen((open) => !open)}>
          {logOpen ? "Ausblenden" : "Anzeigen"}
          {logOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </Button>
      </div>
      {logOpen && <UpdateLogView logs={logs} />}
    </Panel>
  );
}
