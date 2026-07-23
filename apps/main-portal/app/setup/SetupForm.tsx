"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import { IconAlertCircle, IconShieldLock } from "@tabler/icons-react";
import { setupAdminAction } from "../lib/user-actions";
import { initialActionState } from "../lib/action-state";
import classes from "./SetupForm.module.css";

export function SetupForm() {
  const [state, formAction, pending] = useActionState(setupAdminAction, initialActionState);
  const router = useRouter();

  // After the admin is created, jump straight to the app (auto sign-in below).
  useEffect(() => {
    if (state.success) router.push("/login?setup=1");
  }, [state.success, router]);

  return (
    <Center className={classes.screen}>
      <Card withBorder radius="md" p="xl" className={classes.card}>
        <Stack gap="sm" align="center" mb="md">
          <ThemeIcon size={44} radius="md" variant="light" color="slate">
            <IconShieldLock size={24} stroke={1.6} />
          </ThemeIcon>
          <div style={{ textAlign: "center" }}>
            <Title order={3}>Willkommen bei Zählwerk</Title>
            <Text c="dimmed" size="sm">
              Erster Start – lege den Administrator-Account an.
            </Text>
          </div>
        </Stack>

        <form action={formAction}>
          <Stack gap="sm">
            <TextInput name="name" label="Name (optional)" placeholder="Max Mustermann" />
            <TextInput name="email" label="E-Mail" type="email" placeholder="admin@example.com" required />
            <PasswordInput
              name="password"
              label="Passwort"
              description="Mindestens 8 Zeichen"
              placeholder="••••••••"
              required
            />

            {state.error && (
              <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
                {state.error}
              </Alert>
            )}

            <Button type="submit" color="slate" loading={pending} fullWidth mt="xs">
              Administrator anlegen
            </Button>
          </Stack>
        </form>
      </Card>
    </Center>
  );
}
