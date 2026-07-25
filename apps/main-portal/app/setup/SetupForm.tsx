"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { IconAlertCircle, IconShieldLock } from "@tabler/icons-react";
import { setupAdminAction } from "../lib/user-actions";
import { initialActionState } from "../lib/action-state";
import { AuthShell } from "../components/ui/AuthShell";
import { Button } from "../components/ui/Button";
import { Field, PasswordInput, TextInput } from "../components/ui/Field";
import { Alert } from "../components/ui/primitives";

export function SetupForm() {
  const [state, formAction, pending] = useActionState(setupAdminAction, initialActionState);
  const router = useRouter();

  // After the admin is created, jump straight to the login (auto sign-in there).
  useEffect(() => {
    if (state.success) router.push("/login?setup=1");
  }, [state.success, router]);

  return (
    <AuthShell
      icon={<IconShieldLock size={24} stroke={1.7} />}
      title="Willkommen im App Space"
      description="Erster Start – lege den Administrator-Account an."
    >
      <form action={formAction} className="flex flex-col gap-4">
        <Field label="Name (optional)">
          {({ id }) => <TextInput id={id} name="name" placeholder="Max Mustermann" />}
        </Field>
        <Field label="E-Mail" required>
          {({ id }) => (
            <TextInput
              id={id}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="admin@example.com"
              required
            />
          )}
        </Field>
        <Field label="Passwort" description="Mindestens 8 Zeichen" required>
          {({ id, describedBy }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              name="password"
              autoComplete="new-password"
              placeholder="••••••••"
              required
            />
          )}
        </Field>

        {state.error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
            {state.error}
          </Alert>
        )}

        <Button type="submit" variant="primary" full disabled={pending}>
          {pending ? "Wird angelegt…" : "Administrator anlegen"}
        </Button>
      </form>
    </AuthShell>
  );
}
