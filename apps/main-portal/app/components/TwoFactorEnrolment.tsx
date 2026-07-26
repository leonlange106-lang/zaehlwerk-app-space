"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import {
  confirmTwoFactor,
  regenerateTwoFactorSecret,
  type TwoFactorSetup,
} from "@/app/lib/two-factor-actions";
import { Button } from "@/app/components/ui/Button";
import { CopyButton } from "@/app/components/ui/CopyButton";
import { PinInput } from "@/app/components/ui/PinInput";
import { Alert, Code } from "@/app/components/ui/primitives";

// The 2FA enrolment step, in one place.
//
// It is reached from two directions — the settings card and the enforcement gate
// — and they must not drift: this is the screen where a mistake costs someone
// access to their account.

export function TwoFactorEnrolment({
  setup,
  onSetupChange,
  onConfirmed,
}: {
  setup: TwoFactorSetup;
  onSetupChange: (setup: TwoFactorSetup) => void;
  onConfirmed: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmTwoFactor(code);
      if (result.success) {
        onConfirmed();
      } else {
        setError(result.error ?? "Code ist ungültig.");
        setCode("");
      }
    });
  }

  function regenerate() {
    setError(null);
    setCode("");
    startTransition(async () => {
      const result = await regenerateTwoFactorSecret();
      if (result.success) onSetupChange(result.setup);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-center text-sm text-dim">
        Scanne den QR-Code mit deiner Authenticator-App — oder übertrage den Schlüssel darunter von
        Hand. Danach den 6-stelligen Code eingeben.
      </p>

      {/* data: URL generated server-side — nothing for the image pipeline to do
          with it, hence `unoptimized`. */}
      <Image
        src={setup.qrDataUrl}
        alt="2FA QR-Code"
        width={200}
        height={200}
        unoptimized
        className="rounded-control bg-white p-2"
      />

      {/* The manual path deserves the same care as the QR: on a phone the
          authenticator and the browser are the same screen, so scanning is often
          impossible and copying is the ONLY way through. */}
      <div className="well flex w-full flex-col gap-2 rounded-panel p-3">
        <p className="legend-label">Konfigurationsschlüssel</p>
        <Code className="break-all text-center" data-testid="totp-secret">
          {setup.secret}
        </Code>
        <CopyButton value={setup.secret} size="sm" full idleLabel="Schlüssel kopieren" />
        <p className="text-xs text-dim">
          Konto: <strong className="text-ink">{setup.account}</strong> · Typ: zeitbasiert (TOTP),
          6 Stellen, 30 Sekunden
        </p>
      </div>

      <PinInput
        value={code}
        onChange={setCode}
        onComplete={confirm}
        disabled={isPending}
        label="6-stelliger Code"
      />

      <Button variant="primary" full disabled={isPending || code.length !== 6} onClick={confirm}>
        {isPending ? "Wird geprüft…" : "Aktivieren"}
      </Button>

      {error && (
        <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />} className="w-full">
          {error}
        </Alert>
      )}

      {/* Only useful once something has gone wrong, so it sits last and quiet.
          A new key invalidates whatever a password manager already stored — the
          copy above is the normal path, this is the way out of a half-finished
          transfer. */}
      <Button variant="ghost" size="sm" disabled={isPending} onClick={regenerate}>
        <IconRefresh size={14} />
        Neuen Schlüssel erzeugen
      </Button>
    </div>
  );
}
