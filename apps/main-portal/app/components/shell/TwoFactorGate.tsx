"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconAlertCircle, IconLogout, IconShieldLock } from "@tabler/icons-react";
import { startTwoFactorSetup, type TwoFactorSetup } from "@/app/lib/two-factor-actions";
import { TwoFactorEnrolment } from "@/app/components/TwoFactorEnrolment";
import { Button } from "@/app/components/ui/Button";
import { Panel } from "@/app/components/ui/Panel";
import { Alert } from "@/app/components/ui/primitives";
import { signOutToLogin } from "@/app/lib/sign-out";

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
  const [error, setError] = useState<string | null>(null);

  function beginSetup() {
    setError(null);
    startTransition(async () => {
      const result = await startTwoFactorSetup();
      if (result.success) setSetup(result.setup);
      else setError(result.error);
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
          <TwoFactorEnrolment
            setup={setup}
            onSetupChange={setSetup}
            // The gate is resolved server-side per request, so re-rendering the
            // route is all it takes for the app to appear.
            onConfirmed={() => router.refresh()}
          />
        )}

        {error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />} className="mt-4">
            {error}
          </Alert>
        )}
      </Panel>

      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => void signOutToLogin()}>
          <IconLogout size={15} />
          Abmelden
        </Button>
      </div>
    </div>
  );
}
