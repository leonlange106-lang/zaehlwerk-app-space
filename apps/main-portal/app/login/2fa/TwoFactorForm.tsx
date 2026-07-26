"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { IconAlertCircle, IconShieldLock } from "@tabler/icons-react";
import { AuthShell } from "@/app/components/ui/AuthShell";
import { Button } from "@/app/components/ui/Button";
import { isPinComplete, PinInput } from "@/app/components/ui/PinInput";
import { Alert } from "@/app/components/ui/primitives";
import { clearLoginChallenge, diagnoseTwoFactorFailure } from "@/app/lib/login-actions";

export function TwoFactorForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // `value` comes from the caller, never from `code` state: PinInput fires
  // onChange and onComplete in the same synchronous block, so at that instant
  // state still holds five digits.
  async function submit(value: string) {
    setError(null);
    setPending(true);
    try {
      const result = await signIn("credentials", { mode: "totp", code: value, redirect: false });
      if (!result || result.error) {
        // Ask the server WHY. A rejection here has four causes and only one of
        // them is a wrong code — a dropped challenge cookie and a drifted server
        // clock both reject every code that will ever be typed, and saying
        // "ungültig" sends the user round the loop forever.
        setError(await diagnoseTwoFactorFailure(value));
        setCode("");
        setPending(false);
        return;
      }
      // The password proof has been spent — don't leave it lying around.
      await clearLoginChallenge();
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Bestätigung fehlgeschlagen. Bitte erneut versuchen.");
      setPending(false);
    }
  }

  return (
    <AuthShell
      icon={<IconShieldLock size={24} stroke={1.7} />}
      title="Zwei-Faktor-Bestätigung"
      description="Gib den 6-stelligen Code aus deiner Authenticator-App ein."
      footer={
        <button
          type="button"
          onClick={() => router.push("/login")}
          className="text-xs text-dim underline-offset-2 hover:underline"
        >
          Zurück zur Anmeldung
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <PinInput
          length={6}
          value={code}
          onChange={setCode}
          onComplete={submit}
          disabled={pending}
          label="6-stelliger Code"
        />

        {error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        <Button
          variant="primary"
          full
          disabled={!isPinComplete(code) || pending}
          onClick={() => submit(code)}
        >
          {pending ? "Wird geprüft…" : "Bestätigen"}
        </Button>
      </div>
    </AuthShell>
  );
}
