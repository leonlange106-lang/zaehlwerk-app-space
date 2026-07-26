"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconAlertCircle, IconShieldLock } from "@tabler/icons-react";
import {
  disableTwoFactor,
  startTwoFactorSetup,
  type TwoFactorSetup,
} from "@/app/lib/two-factor-actions";
import { TwoFactorEnrolment } from "@/app/components/TwoFactorEnrolment";
import { setEnforceTwoFactorAction } from "@/app/lib/security-policy-actions";
import { Button } from "@/app/components/ui/Button";
import { Panel } from "@/app/components/ui/Panel";
import { PinInput } from "@/app/components/ui/PinInput";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import { StatusBadge } from "@/app/components/ui/StatusBadge";
import { useToast } from "@/app/components/ui/Toast";
import { Alert, Code, Switch } from "@/app/components/ui/primitives";

export function SecurityCard({
  twoFactorEnabled,
  enforceTwoFactor,
  isAdmin,
}: {
  twoFactorEnabled: boolean;
  enforceTwoFactor: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  // Optimistic: the switch must move on touch, or it reads as broken while the
  // server action round-trips.
  const [enforced, setEnforced] = useState(enforceTwoFactor);
  const [policySaving, startPolicySave] = useTransition();

  function toggleEnforcement(next: boolean) {
    setEnforced(next);
    startPolicySave(async () => {
      const result = await setEnforceTwoFactorAction(next);
      if (!result.success) {
        setEnforced(result.enforced);
        toast.show({
          tone: "risk",
          title: "Richtlinie nicht gespeichert",
          message: result.error ?? "Unbekannter Fehler.",
        });
        return;
      }
      toast.show({
        tone: "ok",
        title: next ? "2FA-Pflicht aktiv" : "2FA-Pflicht aufgehoben",
        message:
          next && result.affectedUsers
            ? `${result.affectedUsers} Konto/Konten ohne zweiten Faktor sind bis zur Einrichtung gesperrt.`
            : undefined,
      });
      router.refresh();
    });
  }

  function beginSetup() {
    setError(null);
    startTransition(async () => {
      const result = await startTwoFactorSetup();
      if (result.success) {
        setSetup(result.setup);
        setCode("");
      } else {
        toast.show({ tone: "risk", title: "2FA-Einrichtung fehlgeschlagen", message: result.error });
      }
    });
  }

  function disable() {
    setError(null);
    startTransition(async () => {
      const result = await disableTwoFactor(code);
      if (result.success) {
        setDisableOpen(false);
        setCode("");
        toast.show({ tone: "ok", title: "2FA deaktiviert" });
        router.refresh();
      } else {
        setError(result.error ?? "Fehler.");
        setCode("");
      }
    });
  }

  return (
    <Panel
      title="Sicherheit · Zwei-Faktor-Authentifizierung"
      icon={<IconShieldLock size={17} stroke={1.7} />}
      action={
        <StatusBadge
          tone={twoFactorEnabled ? "ok" : "neutral"}
          label={twoFactorEnabled ? "Aktiv" : "Inaktiv"}
        />
      }
    >
      {twoFactorEnabled ? (
        <div className="flex flex-col items-start gap-4">
          <p className="text-sm text-dim">
            Dein Konto ist mit einer Authenticator-App abgesichert. Beim Login wird zusätzlich ein
            6-stelliger Code abgefragt.
          </p>
          {enforced ? (
            <p className="text-sm text-dim">
              Abschalten ist nicht möglich, solange diese Instanz 2FA verlangt.
            </p>
          ) : (
            <Button
              variant="danger"
              onClick={() => {
                setDisableOpen(true);
                setCode("");
                setError(null);
              }}
            >
              2FA deaktivieren
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4">
          <p className="text-sm text-dim">
            Schütze dein Konto mit einer Authenticator-App (Google Authenticator, 1Password,
            Aegis …).
          </p>
          <Button variant="primary" disabled={isPending && !setup} onClick={beginSetup}>
            {isPending && !setup ? "Wird vorbereitet…" : "2FA einrichten"}
          </Button>
        </div>
      )}

      {isAdmin && (
        <div className="well mt-5 flex flex-col gap-3 rounded-panel p-4">
          <Switch
            checked={enforced}
            disabled={policySaving}
            onChange={toggleEnforcement}
            label="2FA für alle Konten erzwingen"
            data-testid="enforce-2fa"
          />
          <p className="text-xs text-dim">
            Gilt instanzweit. Konten ohne zweiten Faktor kommen erst wieder in die Anwendung, wenn
            sie einen eingerichtet haben — auch über die API. Konten, die noch ihr Passwort vergeben
            müssen, tun das zuerst.
          </p>
          <p className="text-xs text-dim">
            Falls der Authenticator verloren geht und niemand mehr hereinkommt:{" "}
            <Code>DISABLE_2FA_ENFORCEMENT=1</Code> in der Compose-Datei setzen und den Container neu
            starten — das setzt die Pflicht aus, ohne sie zu löschen.
          </p>
          {enforced && !twoFactorEnabled && (
            <Alert tone="watch" icon={<IconAlertCircle size={16} />}>
              Dein eigenes Konto hat noch keinen zweiten Faktor. Nach dem nächsten Seitenwechsel
              wirst du zur Einrichtung geführt.
            </Alert>
          )}
        </div>
      )}

      {/* Enrolment */}
      <ResponsiveDialog
        opened={setup !== null}
        onClose={() => setSetup(null)}
        title="2FA einrichten"
        size="sm"
      >
        {setup && (
          <TwoFactorEnrolment
            setup={setup}
            onSetupChange={setSetup}
            onConfirmed={() => {
              setSetup(null);
              toast.show({ tone: "ok", title: "2FA aktiviert" });
              router.refresh();
            }}
          />
        )}
      </ResponsiveDialog>

      {/* Removal */}
      <ResponsiveDialog
        opened={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="2FA deaktivieren"
        size="sm"
        footer={
          <Button
            variant="danger"
            full
            disabled={isPending || code.length !== 6}
            onClick={disable}
          >
            {isPending ? "Wird geprüft…" : "2FA deaktivieren"}
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-4">
          <p className="text-center text-sm text-dim">
            Gib zur Bestätigung einen aktuellen Code aus deiner Authenticator-App ein.
          </p>
          <PinInput
            value={code}
            onChange={setCode}
            onComplete={disable}
            disabled={isPending}
            label="6-stelliger Code"
          />
          {error && (
            <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />} className="w-full">
              {error}
            </Alert>
          )}
        </div>
      </ResponsiveDialog>
    </Panel>
  );
}
