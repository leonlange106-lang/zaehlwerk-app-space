"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  Alert,
  Button,
  Card,
  Center,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconBolt, IconCheck } from "@tabler/icons-react";
import classes from "./LoginForm.module.css";

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
    <Center className={classes.screen}>
      <Card withBorder radius="md" p="xl" className={classes.card}>
        <Stack gap="sm" align="center" mb="md">
          <ThemeIcon size={44} radius="md" variant="filled" color="slate">
            <IconBolt size={24} stroke={1.6} />
          </ThemeIcon>
          <div style={{ textAlign: "center" }}>
            <Title order={3}>Zählwerk</Title>
            <Text c="dimmed" size="sm">
              Bitte melde dich an.
            </Text>
          </div>
        </Stack>

        {justSetUp && (
          <Alert color="green" icon={<IconCheck size={16} />} variant="light" mb="sm">
            Admin-Account erstellt. Melde dich jetzt an.
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            <TextInput
              label="E-Mail"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
            />
            <PasswordInput
              label="Passwort"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
            />

            {error && (
              <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
                {error}
              </Alert>
            )}

            <Button type="submit" color="slate" loading={pending} fullWidth mt="xs">
              Anmelden
            </Button>
          </Stack>
        </form>
      </Card>
    </Center>
  );
}
