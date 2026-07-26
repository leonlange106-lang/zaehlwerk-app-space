"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { IconAlertCircle, IconLogout, IconShieldLock } from "@tabler/icons-react";
import {
  confirmTwoFactor,
  startTwoFactorSetup,
  type TwoFactorSetup,
} from "@/app/lib/two-factor-actions";
import { Button } from "@/app/components/ui/Button";
import { Panel } from "@/app/components/ui/Panel";
import { PinInput } from "@/app/components/ui/PinInput";
import { Alert, Code } from "@/app/components/ui/primitives";

// The enrolment screen shown INSTEAD of the app when the instance requires a
// second factor and this account has none.
//
// It is rendered by the root layout in place of `children`, so the page behind
// it is never produced — there is no "hidden" content to reveal with devtools,
// and no route that happens to be exempt. Sign-out stays available: an account
// that cannot or will not enrol must still be able to leave.

export function TwoFactorGate({ email }: { email: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function beginSetup() {
    setError(null);
    startTransition(async () => {
      const result = await startTwoFactorSetup();
      if (result.success) {
        setSetup(result.setup);
        setCode("");
      } else {
        setError(result.error);
      }
    });
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmTwoFactor(code);
      if (result.success) {
        // The gate is resolved server-side per request, so re-rendering the
        // route is all it takes for the app to appear.
        router.refresh();
      } else {
        setError(result.error ?? "Code ist ungültig.");
        setCode("");
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 py-6">
      <Panel
        title="Zwei-Faktor-Authentifizierung erforderlich"
        description="Diese Instanz verlangt für jedes Konto einen zweiten Faktor. Bis er eingerichtet ist, bleibt der Zugriff gesperrt."
        icon={<IconShieldLock size={18} stroke={1.7} />}
      >
        {!setup ? (
          <div className="flex flex-col items-start gap-4">
            <p className="text-sm text-dim">
              Du brauchst eine Authenticator-App (Google Authenticator, 1Password, Aegis …).
              {email && (
                <>
                  {" "}
                  Angemeldet als <strong className="text-ink">{email}</strong>.
                </>
              )}
            </p>
            <Button variant="primary" disabled={isPending} onClick={beginSetup}>
              {isPending ? "Wird vorbereitet…" : "2FA jetzt einrichten"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <p className="text-center text-sm text-dim">
              Scanne den QR-Code mit deiner Authenticator-App und gib dann den 6-stelligen Code ein.
            </p>
            {/* data: URL generated server-side — nothing for the image pipeline
                to optimise, hence `unoptimized`. */}
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
            <Button
              variant="primary"
              full
              disabled={isPending || code.length !== 6}
              onClick={confirm}
            >
              {isPending ? "Wird geprüft…" : "Aktivieren und fortfahren"}
            </Button>
          </div>
        )}

        {error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />} className="mt-4">
            {error}
          </Alert>
        )}
      </Panel>

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => void signOut({ callbackUrl: "/login" })}>
          <IconLogout size={15} />
          Abmelden
        </Button>
      </div>
    </div>
  );
}
