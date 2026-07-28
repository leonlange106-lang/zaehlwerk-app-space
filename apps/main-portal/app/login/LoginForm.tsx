"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { beginLoginAction } from "../lib/login-actions";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";
import { AuthShell } from "../components/ui/AuthShell";
import { Button } from "../components/ui/Button";
import { Field, PasswordInput, TextInput } from "../components/ui/Field";
import { Alert } from "../components/ui/primitives";

/**
 * Text der Sperrmeldung.
 *
 * Sagt, wie lange — sonst bleibt nur „irgendwann später", und wer nicht weiß,
 * wann, probiert es sofort wieder und dreht den Zähler dabei weiter.
 */
function lockoutMessage(retryAfter: number | undefined): string {
  const seconds = typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : 0;
  if (seconds === 0) return "Zu viele Anmeldeversuche. Bitte später erneut versuchen.";
  const minutes = Math.ceil(seconds / 60);
  return `Zu viele Anmeldeversuche. Bitte in ${minutes} Minute${minutes === 1 ? "" : "n"} erneut versuchen.`;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const justSetUp = searchParams.get("setup") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      // Step 1: verify credentials without issuing a session yet.
      const precheck = await beginLoginAction(email, password);
      // Die Sperre wird von „falsch getippt" UNTERSCHIEDEN — und zwar hier,
      // sonst steht die Unterscheidung nur im Kommentar der Server-Action und
      // niemand sieht sie je. Wer richtig tippt und trotzdem abgewiesen wird,
      // tippt es noch zehnmal und dreht den Zähler dabei weiter.
      //
      // Verraten wird damit nichts: Die Sperre greift für existierende wie für
      // nicht existierende Konten gleich.
      if (precheck.lockedOut) {
        setError(lockoutMessage(precheck.retryAfter));
        setPending(false);
        return;
      }
      if (!precheck.ok) {
        setError("E-Mail oder Passwort ist falsch.");
        setPending(false);
        return;
      }
      // Step 2a: temp-password account → passwordless session, then set-password.
      if (precheck.mustSetPassword) {
        const result = await signIn("credentials", { email, mode: "firstlogin", redirect: false });
        if (!result || result.error) {
          setError("Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
          setPending(false);
          return;
        }
        router.push("/set-password");
        router.refresh();
        return;
      }
      // Step 2b: 2FA on → continue at /login/2fa (challenge cookie is set).
      if (precheck.twoFactorRequired) {
        router.push(`/login/2fa?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        return;
      }
      // Step 2c: no 2FA → issue the session directly.
      const result = await signIn("credentials", { email, password, redirect: false });
      if (!result || result.error) {
        setError("E-Mail oder Passwort ist falsch.");
        setPending(false);
        return;
      }
      // Full navigation so the server layout re-reads the new session.
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
      setPending(false);
    }
  }

  return (
    <AuthShell
      icon={
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src="/mark-appspace.svg" alt="" width={26} height={26} />
      }
      title="App Space"
      description="Bitte melde dich an."
    >
      {justSetUp && (
        <Alert tone="ok" icon={<IconCheck size={16} />} className="mb-4">
          Admin-Account erstellt. Melde dich jetzt an.
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="E-Mail" required>
          {({ id }) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
            />
          )}
        </Field>
        <Field
          label="Passwort"
          description="Erstanmeldung? Feld leer lassen – du vergibst dein Passwort danach."
        >
          {({ id, describedBy }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          )}
        </Field>

        {error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        <Button type="submit" variant="primary" full disabled={pending}>
          {pending ? "Wird angemeldet…" : "Anmelden"}
        </Button>
      </form>
    </AuthShell>
  );
}
