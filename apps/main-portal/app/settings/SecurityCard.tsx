"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { IconAlertCircle, IconShieldLock } from "@tabler/icons-react";
import {
  confirmTwoFactor,
  disableTwoFactor,
  startTwoFactorSetup,
  type TwoFactorSetup,
} from "@/app/lib/two-factor-actions";
import { Button } from "@/app/components/ui/Button";
import { Panel } from "@/app/components/ui/Panel";
import { PinInput } from "@/app/components/ui/PinInput";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import { StatusBadge } from "@/app/components/ui/StatusBadge";
import { useToast } from "@/app/components/ui/Toast";
import { Alert, Code } from "@/app/components/ui/primitives";

export function SecurityCard({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);

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

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmTwoFactor(code);
      if (result.success) {
        setSetup(null);
        setCode("");
        toast.show({ tone: "ok", title: "2FA aktiviert" });
        router.refresh();
      } else {
        setError(result.error ?? "Fehler.");
        setCode("");
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

      {/* Enrolment */}
      <ResponsiveDialog
        opened={setup !== null}
        onClose={() => setSetup(null)}
        title="2FA einrichten"
        size="sm"
        footer={
          <Button
            variant="primary"
            full
            disabled={isPending || code.length !== 6}
            onClick={confirm}
          >
            {isPending ? "Wird geprüft…" : "Aktivieren"}
          </Button>
        }
      >
        {setup && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-center text-sm text-dim">
              Scanne den QR-Code mit deiner Authenticator-App und gib dann den 6-stelligen Code
              ein.
            </p>
            {/* The QR is a data: URL generated server-side — `unoptimized` because
                there is nothing for the image pipeline to do with it. */}
            <Image
              src={setup.qrDataUrl}
              alt="2FA QR-Code"
              width={200}
              height={200}
              unoptimized
              className="rounded-control bg-white p-2"
            />
            <p className="text-center text-xs text-dim">
              Manuell: <Code>{setup.secret}</Code>
            </p>
            <PinInput
              value={code}
              onChange={setCode}
              onComplete={confirm}
              disabled={isPending}
              label="6-stelliger Code"
            />
            {error && (
              <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />} className="w-full">
                {error}
              </Alert>
            )}
          </div>
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
