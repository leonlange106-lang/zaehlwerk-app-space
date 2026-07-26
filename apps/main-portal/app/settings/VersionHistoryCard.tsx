"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconCircleCheck,
  IconHistory,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { Badge, BetaBadge } from "@/app/components/ui/Badge";
import { Button } from "@/app/components/ui/Button";
import { Field, PasswordInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import { Skeleton } from "@/app/components/ui/Skeleton";
import { Alert, Code } from "@/app/components/ui/primitives";
import type { VersionCandidate } from "@/app/lib/version-candidates";
import type { ReleaseChannel } from "@zaehlwerk/updater";

// Going back to an earlier build.
//
// Deliberately its own card rather than a control inside "System-Update": an
// update is routine, a rollback is not, and the two should not sit one tab-stop
// apart. The progress of a started rollback is shown by the System-Update panel
// above — one update state, one place that renders it.

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatStamp(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? dateFormatter.format(new Date(parsed)) : null;
}

interface VersionListResponse {
  channel: ReleaseChannel;
  runningSha: string | null;
  candidates: VersionCandidate[];
  releasesUnavailable: boolean;
}

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; data: VersionListResponse };

/**
 * One row of the version list.
 *
 * The running build gets a marker and NO button — "roll back to the version you
 * are on" is not an action, and offering it as one only invites a pointless
 * rebuild.
 */
function VersionRow({
  candidate,
  disabled,
  onSelect,
}: {
  candidate: VersionCandidate;
  disabled: boolean;
  onSelect: (candidate: VersionCandidate) => void;
}) {
  const installed = formatStamp(candidate.installedAt);
  const published = formatStamp(candidate.publishedAt);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{candidate.label}</span>
          {candidate.preRelease && <BetaBadge />}
          {candidate.running && (
            <Badge tone="accent">
              <IconPlayerPlay size={11} aria-hidden />
              Läuft gerade
            </Badge>
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim">
          <Code>{candidate.ref}</Code>
          {installed && <span>hier installiert am {installed}</span>}
          {!installed && published && <span>veröffentlicht am {published}</span>}
        </p>
      </div>

      {candidate.running ? (
        <span className="flex items-center gap-1.5 text-xs text-dim">
          <IconCircleCheck size={15} className="flex-none text-ok" aria-hidden />
          Aktueller Stand
        </span>
      ) : (
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(candidate)}
          data-testid="rollback-select"
        >
          <IconArrowBackUp size={15} />
          Zu dieser Version
        </Button>
      )}
    </li>
  );
}

export function VersionHistoryCard({ tokenRequired }: { tokenRequired: boolean }) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [selected, setSelected] = useState<VersionCandidate | null>(null);
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/system/versions", { cache: "no-store" });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setList({ status: "error", message: data.error ?? "Versionen konnten nicht geladen werden." });
          return;
        }
        setList({ status: "done", data: data as VersionListResponse });
      } catch {
        if (!cancelled) {
          setList({ status: "error", message: "Versionen konnten nicht geladen werden (Netzwerkfehler)." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Open the confirmation, restoring a remembered update token on the way.
   *
   * The token is read HERE rather than in a mount effect for two reasons: it is
   * not needed until this dialog exists, and reading localStorage during the
   * first render would make the server and client render different values for a
   * controlled input — a hydration mismatch. An event handler has neither problem.
   */
  const openConfirm = useCallback(
    (candidate: VersionCandidate) => {
      setError(null);
      setSelected(candidate);
      if (!tokenRequired) return;
      setToken((current) => {
        if (current) return current;
        try {
          return window.localStorage.getItem("zaehlwerk.updateToken") ?? "";
        } catch {
          // localStorage unavailable (private mode) — just skip remembering
          return "";
        }
      });
    },
    [tokenRequired],
  );

  const confirmRollback = useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/update/rollback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-update-token": token } : {}),
        },
        body: JSON.stringify({ ref: selected.ref }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Rollback konnte nicht gestartet werden.");
        return;
      }
      if (token) {
        try {
          window.localStorage.setItem("zaehlwerk.updateToken", token);
        } catch {
          // ignore
        }
      }
      setStarted(selected.label);
      setSelected(null);
    } catch {
      setError("Rollback konnte nicht gestartet werden (Netzwerkfehler).");
    } finally {
      setSubmitting(false);
    }
  }, [selected, token]);

  const busy = submitting || Boolean(started);

  return (
    <Panel
      title="Frühere Version einspielen"
      description="Setzt die Instanz auf einen älteren Stand zurück — derselbe Deploy-Weg wie ein Update, nur mit einer früheren Version als Ziel."
      icon={<IconHistory size={18} />}
      data-testid="version-history"
    >
      {started && (
        <Alert
          tone="info"
          role="status"
          className="mb-4"
          icon={<IconArrowBackUp size={18} />}
          title={`Rollback auf ${started} gestartet`}
        >
          Der Fortschritt läuft oben unter „System-Update“ — dort erscheinen Schritte und Live-Log,
          und die Seite lädt nach dem Neustart selbst neu.
        </Alert>
      )}

      {error && (
        <Alert tone="risk" role="alert" className="mb-4" icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}

      <Alert
        tone="watch"
        className="mb-4"
        icon={<IconAlertTriangle size={18} />}
        title="Die Datenbank wandert nicht mit zurück"
      >
        Schemaänderungen sind additiv und werden beim Rollback <strong>nicht</strong> rückgängig
        gemacht — sonst würden genau die Daten gelöscht, die die neuere Version angelegt hat. Die
        ältere Anwendung läuft auf dem neueren Schema weiter und ignoriert, was sie nicht kennt.
        Wenn ein Stand weiter zurückliegt, ist ein Backup der verlässlichere Weg.
      </Alert>

      {/* Reserved from first paint: this list arrives after a fetch, and a card
          that grows on load pushes the buttons below it out from under the
          finger. Three rows is the usual height. */}
      {list.status === "loading" && (
        <ul className="flex flex-col" aria-busy="true" aria-label="Versionen werden geladen">
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0"
            >
              <div className="flex flex-col gap-2">
                <Skeleton width={160} height={15} />
                <Skeleton width={220} height={12} />
              </div>
              <Skeleton width={150} height={40} />
            </li>
          ))}
        </ul>
      )}

      {list.status === "error" && (
        <Alert tone="risk" role="alert" icon={<IconAlertTriangle size={18} />}>
          {list.message}
        </Alert>
      )}

      {list.status === "done" && (
        <>
          {list.data.releasesUnavailable && (
            <Alert tone="watch" className="mb-4" icon={<IconAlertTriangle size={18} />}>
              GitHub ist gerade nicht erreichbar. Angezeigt werden nur Versionen, die auf dieser
              Instanz schon einmal liefen.
            </Alert>
          )}

          {list.data.candidates.length === 0 ? (
            <p className="text-sm text-dim">
              Noch keine Versionen aufgezeichnet. Der erste Eintrag entsteht mit dem nächsten Update
              über diese Oberfläche.
            </p>
          ) : (
            <ul className="flex flex-col" data-testid="version-list">
              {list.data.candidates.map((candidate) => (
                <VersionRow
                  key={candidate.ref}
                  candidate={candidate}
                  disabled={busy}
                  onSelect={openConfirm}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <ResponsiveDialog
        opened={Boolean(selected)}
        onClose={() => setSelected(null)}
        closeDisabled={submitting}
        title="Version zurücksetzen"
        size="sm"
        data-testid="rollback-confirm"
        footer={
          <>
            <Button variant="ghost" disabled={submitting} onClick={() => setSelected(null)}>
              Abbrechen
            </Button>
            <Button
              variant="primary"
              disabled={submitting || (tokenRequired && !token)}
              onClick={() => void confirmRollback()}
              data-testid="rollback-confirm-submit"
            >
              <IconArrowBackUp size={16} />
              {submitting ? "Wird gestartet…" : "Rollback starten"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Die Instanz wird auf <strong className="text-ink">{selected?.label}</strong> (
            <Code>{selected?.ref}</Code>) zurückgesetzt. Der Stand wird neu gebaut und die Anwendung
            neu gestartet — das dauert einige Minuten, in denen sie kurz nicht erreichbar ist.
          </p>
          <p className="text-sm text-dim">
            Die Datenbank bleibt auf dem aktuellen Schema. Beim nächsten Update geht es von der
            zurückgesetzten Version aus wieder vorwärts.
          </p>

          {tokenRequired && (
            <Field
              label="Update-Token"
              description="Nötig, weil UPDATE_TRIGGER_TOKEN auf dem Server gesetzt ist."
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
        </div>
      </ResponsiveDialog>
    </Panel>
  );
}
