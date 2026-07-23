"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  PasswordInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconShieldLock } from "@tabler/icons-react";
import { completePasswordSetupAction } from "../lib/login-actions";
import classes from "../login/LoginForm.module.css";

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
    <Center className={classes.screen}>
      <Card withBorder radius="md" p="xl" className={classes.card}>
        <Stack gap="sm" align="center" mb="md">
          <IconShieldLock size={40} stroke={1.4} color="var(--mantine-color-slate-6)" />
          <div style={{ textAlign: "center" }}>
            <Title order={3}>Passwort festlegen</Title>
            <Text c="dimmed" size="sm">
              Lege für <strong>{email}</strong> ein eigenes Passwort fest, um fortzufahren.
            </Text>
          </div>
        </Stack>

        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            <PasswordInput
              label="Neues Passwort"
              description="Mindestens 8 Zeichen"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              error={tooShort ? "Mindestens 8 Zeichen." : undefined}
              required
              data-autofocus
            />
            <PasswordInput
              label="Passwort bestätigen"
              placeholder="••••••••"
              value={confirm}
              onChange={(event) => setConfirm(event.currentTarget.value)}
              error={mismatch ? "Die Passwörter stimmen nicht überein." : undefined}
              required
            />

            {error && (
              <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
                {error}
              </Alert>
            )}

            <Button type="submit" color="slate" loading={pending} disabled={!canSubmit} fullWidth mt="xs">
              Passwort speichern &amp; fortfahren
            </Button>
            <Anchor
              component="button"
              type="button"
              size="xs"
              c="dimmed"
              ta="center"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              Abmelden
            </Anchor>
          </Stack>
        </form>
      </Card>
    </Center>
  );
}
