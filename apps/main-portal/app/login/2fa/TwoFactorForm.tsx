"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  Alert,
  Button,
  Card,
  Center,
  PinInput,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconShieldLock } from "@tabler/icons-react";
import classes from "../LoginForm.module.css";

export function TwoFactorForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(value: string) {
    setError(null);
    setPending(true);
    try {
      const result = await signIn("credentials", { mode: "totp", code: value, redirect: false });
      if (!result || result.error) {
        setError("Code ist ungültig oder abgelaufen. Bitte erneut anmelden.");
        setCode("");
        setPending(false);
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Bestätigung fehlgeschlagen. Bitte erneut versuchen.");
      setPending(false);
    }
  }

  return (
    <Center className={classes.screen}>
      <Card withBorder radius="md" p="xl" className={classes.card}>
        <Stack gap="sm" align="center" mb="md">
          <ThemeIcon size={44} radius="md" variant="light" color="slate">
            <IconShieldLock size={24} stroke={1.6} />
          </ThemeIcon>
          <div style={{ textAlign: "center" }}>
            <Title order={3}>Zwei-Faktor-Bestätigung</Title>
            <Text c="dimmed" size="sm">
              Gib den 6-stelligen Code aus deiner Authenticator-App ein.
            </Text>
          </div>
        </Stack>

        <Stack gap="md" align="center">
          <PinInput
            length={6}
            type="number"
            oneTimeCode
            value={code}
            onChange={setCode}
            onComplete={submit}
            disabled={pending}
            aria-label="6-stelliger Code"
          />

          {error && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light" w="100%">
              {error}
            </Alert>
          )}

          <Button
            color="slate"
            fullWidth
            loading={pending}
            disabled={code.length !== 6}
            onClick={() => submit(code)}
          >
            Bestätigen
          </Button>
          <Button variant="subtle" color="slate" size="xs" onClick={() => router.push("/login")}>
            Zurück zur Anmeldung
          </Button>
        </Stack>
      </Card>
    </Center>
  );
}
