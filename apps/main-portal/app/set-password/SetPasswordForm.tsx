"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { IconAlertCircle, IconShieldLock } from "@tabler/icons-react";
import { completePasswordSetupAction } from "../lib/login-actions";
import { AuthShell } from "../components/ui/AuthShell";
import { Button } from "../components/ui/Button";
import { Field, PasswordInput } from "../components/ui/Field";
import { Alert } from "../components/ui/primitives";

// Forced first-login password setup. The account was created with a temp
// password; the user must set a real one here before any app becomes usable.
export function SetPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const { update } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= 8 && confirm === password && !pending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setPending(true);
    try {
      const result = await completePasswordSetupAction(password);
      if (!result.success) {
        setError(result.error ?? "Das Passwort konnte nicht gespeichert werden.");
        setPending(false);
        return;
      }
      // Clear the flag in the JWT so the middleware gate lifts without re-login.
      await update({ mustSetPassword: false });
      router.push("/");
      router.refresh();
    } catch {
      setError("Es ist ein Fehler aufgetreten. Bitte erneut versuchen.");
      setPending(false);
    }
  }

  return (
    <AuthShell
      icon={<IconShieldLock size={24} stroke={1.7} />}
      title="Passwort festlegen"
      description={
        <>
          Lege für <strong className="text-ink">{email}</strong> ein eigenes Passwort fest, um
          fortzufahren.
        </>
      }
      footer={
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-xs text-dim underline-offset-2 hover:underline"
        >
          Abmelden
        </button>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label="Neues Passwort"
          description="Mindestens 8 Zeichen"
          error={tooShort ? "Mindestens 8 Zeichen." : undefined}
          required
        >
          {({ id, describedBy }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              autoFocus
            />
          )}
        </Field>
        <Field
          label="Passwort bestätigen"
          error={mismatch ? "Die Passwörter stimmen nicht überein." : undefined}
          required
        >
          {({ id, describedBy }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              onChange={(event) => setConfirm(event.currentTarget.value)}
              required
            />
          )}
        </Field>

        {error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        <Button type="submit" variant="primary" full disabled={!canSubmit}>
          {pending ? "Wird gespeichert…" : "Passwort speichern & fortfahren"}
        </Button>
      </form>
    </AuthShell>
  );
}
