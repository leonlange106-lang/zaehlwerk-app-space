"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Badge, BetaBadge } from "@/app/components/ui/Badge";
import { Button, ButtonLink } from "@/app/components/ui/Button";
import { Field, PasswordInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { Alert, Code, Progress, SegmentedControl, Spinner } from "@/app/components/ui/primitives";
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
  IconPlayerStop,
  IconTerminal2,
} from "@tabler/icons-react";
import classes from "./SettingsView.module.css";
import type { LocalCommitInfo, ReleaseChannel, UpdateCheckResult } from "@zaehlwerk/updater";
import {
  isCancellable,
  normalizeUpdateState,
  UPDATE_STEPS,
  type UpdateState,
} from "@/app/lib/update-status";
import { setUpdateChannelAction } from "@/app/lib/update-channel-actions";

// The System-Update card, lifted out of SettingsView when the settings were split
// into sub-pages. It is by far the largest card — progress stepper, live SSE log,
// channel switch — and it now sits on /settings/system with the version history.

/** "4 min 12 s" — coarse on purpose; nobody is timing this to the second. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * `/api/update/check` returns the updater's result plus the ref the instance's
 * channel currently resolves to — which is what an admin actually needs to see
 * before pressing the button.
 */
type CheckResponse = UpdateCheckResult & {
  target: {
    channel: ReleaseChannel;
    ref: string | null;
    label: string;
    usingBranchFallback: boolean;
    unavailable: boolean;
  };
};

type CheckState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; result: CheckResponse };

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
        <div className="flex flex-col gap-1">
          <p className="text-xs text-dim">
            {state.message || "…"}
            {/* Elapsed time, not an estimate. The Docker build is most of the
                wait, so any "time remaining" would be a number we cannot stand
                behind — how long it HAS taken is something we know exactly, and
                it is what tells someone whether this looks normal. */}
            {state.elapsedSeconds !== null && (
              <>
                {" · seit "}
                <strong className="text-ink" data-testid="update-elapsed">
                  {formatElapsed(state.elapsedSeconds)}
                </strong>
              </>
            )}
          </p>
          {/* The build is the phase that takes minutes. Without its own step
              count the bar sits still and the whole thing looks hung. */}
          {state.buildStep && (
            <p className="text-xs text-dim">
              Build-Schritt <strong className="text-ink">{state.buildStep}</strong>
              {state.buildLabel && (
                <>
                  {" · "}
                  <span className="break-all">{state.buildLabel.slice(0, 90)}</span>
                </>
              )}
            </p>
          )}
        </div>
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

export function UpdateSettingsCard({
  versionInfo,
  channel,
}: {
  versionInfo: LocalCommitInfo | null;
  channel: ReleaseChannel;
}) {
  const [checkState, setCheckState] = useState<CheckState>({ status: "idle" });
  // Optimistic: the select must move the moment it is used, or it reads as
  // broken while the server action round-trips.
  const [channelValue, setChannelValue] = useState<ReleaseChannel>(channel);
  const [channelSaving, startChannelSave] = useTransition();
  const [channelError, setChannelError] = useState<string | null>(null);
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
  const [cancelling, setCancelling] = useState(false);

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
      setCheckState({ status: "done", result: data as CheckResponse });
    } catch {
      setCheckState({ status: "error", message: "Prüfung fehlgeschlagen (Netzwerkfehler)." });
    }
  }

  function handleCancel() {
    setCancelling(true);
    void (async () => {
      try {
        const response = await fetch("/api/update/cancel", {
          method: "POST",
          headers: token ? { "x-update-token": token } : undefined,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          // Not a failure of the update — a refusal to stop it. Surfaced in the
          // same alert so it cannot be missed.
          applyState(
            normalizeUpdateState(
              { stage: state?.stage ?? "building", message: data.error ?? "Abbruch nicht möglich." },
              state?.logs ?? "",
            ),
          );
        }
        // On success the SSE stream delivers the cancelled state within ~1s.
      } finally {
        setCancelling(false);
      }
    })();
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
  // Cancelled is neither: nothing broke, the operator stopped it, and the old
  // build is still serving. Showing it as a failure would send someone hunting
  // through the log for a cause that is not there.
  const cancelled = witnessedRunning && state?.status === "CANCELLED";
  const canCancel = Boolean(state && isCancellable(state));
  // The progress block is global: it appears for anyone whose session witnessed
  // the run, independent of whether they clicked "check for updates".
  const showProgress = Boolean(running || succeeded || failed || cancelled);
  const logs = state?.logs ?? "";

  return (
    <Panel title="System-Update">
      {showProgress && state && (
        <Alert
          className="mb-5"
          tone={failed ? "risk" : succeeded ? "ok" : cancelled ? "watch" : "info"}
          role={failed ? "alert" : "status"}
          icon={
            running ? (
              <Spinner size={16} label="Update läuft" />
            ) : succeeded ? (
              <IconCircleCheck size={18} />
            ) : cancelled ? (
              <IconPlayerStop size={18} />
            ) : (
              <IconCircleX size={18} />
            )
          }
          title={
            running
              ? "System-Update läuft…"
              : succeeded
                ? "Update abgeschlossen"
                : cancelled
                  ? "Update abgebrochen"
                  : "Update fehlgeschlagen"
          }
        >
          <div className="flex flex-col gap-3" data-testid="update-progress">
            <p className="text-xs">
              {running
                ? "Läuft global auf dem Server — der Fortschritt ist in allen geöffneten Sitzungen sichtbar und überdauert einen Reload."
                : succeeded
                  ? "Die Seite lädt neu…"
                  : cancelled
                    ? state.message ||
                      "Abgebrochen. Die laufende Version wurde nicht verändert."
                    : state.error}
            </p>

            <UpdateProgress state={state} failIndex={lastRunningStep} />

            {canCancel && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={cancelling}
                  onClick={handleCancel}
                  data-testid="update-cancel"
                >
                  <IconPlayerStop size={14} />
                  {cancelling ? "Wird abgebrochen…" : "Update abbrechen"}
                </Button>
                <span className="text-xs text-dim">
                  Bis einschließlich der Migration gefahrlos — die laufende Version bleibt aktiv.
                </span>
              </div>
            )}

            {running && !canCancel && (
              <p className="text-xs text-dim">
                Der Neustart läuft — ein Abbruch würde die Anwendung halb ausgetauscht
                zurücklassen und ist deshalb ab hier gesperrt.
              </p>
            )}

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

      <div className="well mb-5 flex flex-col gap-3 rounded-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="legend-label">Release-Channel</p>
          {channelValue === "beta" && <BetaBadge />}
        </div>
        <SegmentedControl
          label="Release-Channel"
          value={channelValue}
          disabled={channelSaving}
          onChange={(next) => {
            setChannelValue(next);
            setChannelError(null);
            startChannelSave(async () => {
              const result = await setUpdateChannelAction(next);
              if (!result.success) {
                // Put the control back where the server says it is, rather than
                // leaving it showing a choice that was never stored.
                setChannelValue(result.channel);
                setChannelError(result.error ?? "Channel konnte nicht gespeichert werden.");
              }
            });
          }}
          options={[
            { value: "stable" as ReleaseChannel, label: "Stable" },
            { value: "beta" as ReleaseChannel, label: "Beta" },
          ]}
          data-testid="update-channel"
        />
        <p className="text-xs text-dim">
          {channelValue === "beta"
            ? "Installiert auch Vorabversionen. Die sind zum Testen gedacht und können Fehler enthalten — ein Backup vor dem Update ist hier keine Formalität."
            : "Installiert nur freigegebene Versionen ohne Vorab-Kennzeichnung."}
        </p>
        <p className="text-xs text-dim">
          Ein Wechsel zurück auf Stable rollt <strong className="text-ink">nicht</strong> zurück:
          Schemaänderungen sind additiv und werden nicht rückgängig gemacht. Die Instanz bleibt auf
          dem Beta-Stand, bis eine stabile Version ihn überholt.
        </p>
        {channelError && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
            {channelError}
          </Alert>
        )}
      </div>

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

      {checkState.status === "done" && (
        <p className="mb-3 text-xs text-dim" data-testid="update-target">
          {checkState.result.target.unavailable ? (
            <>
              Für den Channel „{checkState.result.target.channel}“ ist keine Version veröffentlicht —
              es gibt nichts zu installieren.
            </>
          ) : (
            <>
              Nächstes Update installiert:{" "}
              <strong className="text-ink">{checkState.result.target.label}</strong>
              {checkState.result.target.usingBranchFallback && (
                <>
                  {" — "}Entwicklermodus: <Code>UPDATE_ALLOW_BRANCH</Code> ist gesetzt, deshalb folgt
                  das Update dem Branch statt einer veröffentlichten Version.
                </>
              )}
            </>
          )}
        </p>
      )}

      {checkState.status === "done" && checkState.result.comparisonUnavailable && (
        <Alert tone="watch" icon={<IconAlertCircle size={16} />} className="mb-3">
          Der Versionsvergleich bei GitHub war nicht möglich. „Update verfügbar“ heißt hier nur
          „andere Version“ — ob sie neuer oder älter ist, lässt sich gerade nicht feststellen.
        </Alert>
      )}

      {checkState.status === "done" && !updateAvailable && !checkState.result.target.unavailable && (
        <Alert tone="ok" icon={<IconCheck size={16} />} className="mb-3">
          {checkState.result.comparison === "behind" ? (
            <>
              Diese Instanz läuft auf einem <strong className="text-ink">neueren</strong> Stand, als
              der Channel „{checkState.result.channel}“ anbietet ({checkState.result.currentShortSha}
              ). Ein Update gibt es erst, wenn der Channel nachzieht — zurück geht es über „Frühere
              Version einspielen“.
            </>
          ) : (
            <>Auf dem neuesten Stand ({checkState.result.currentShortSha}).</>
          )}
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

