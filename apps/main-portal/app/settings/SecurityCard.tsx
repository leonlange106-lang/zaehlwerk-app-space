"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  PinInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconCheck, IconShieldCheck, IconShieldLock } from "@tabler/icons-react";
import {
  confirmTwoFactor,
  disableTwoFactor,
  startTwoFactorSetup,
  type TwoFactorSetup,
} from "@/app/lib/two-factor-actions";

export function SecurityCard({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);

  function beginSetup() {
    setError(null);
    startTransition(async () => {
      const result = await startTwoFactorSetup();
      if (result.success) {
        setSetup(result.setup);
        setCode("");
      } else {
        notifications.show({ color: "red", icon: <IconAlertCircle size={16} />, message: result.error });
      }
    });
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmTwoFactor(code);
      if (result.success) {
        setSetup(null);
        setCode("");
        notifications.show({ color: "green", icon: <IconCheck size={16} />, message: "2FA aktiviert." });
        router.refresh();
      } else {
        setError(result.error ?? "Fehler.");
        setCode("");
      }
    });
  }

  function disable() {
    setError(null);
    startTransition(async () => {
      const result = await disableTwoFactor(code);
      if (result.success) {
        setDisableOpen(false);
        setCode("");
        notifications.show({ color: "green", icon: <IconCheck size={16} />, message: "2FA deaktiviert." });
        router.refresh();
      } else {
        setError(result.error ?? "Fehler.");
        setCode("");
      }
    });
  }

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm">
        <IconShieldLock size={18} stroke={1.6} />
        <Title order={4}>Sicherheit · Zwei-Faktor-Authentifizierung</Title>
        {twoFactorEnabled ? (
          <Badge color="green" variant="light" leftSection={<IconShieldCheck size={12} />}>
            Aktiv
          </Badge>
        ) : (
          <Badge color="gray" variant="light">
            Inaktiv
          </Badge>
        )}
      </Group>

      {twoFactorEnabled ? (
        <Stack gap="sm" align="flex-start">
          <Text size="sm" c="dimmed">
            Dein Konto ist mit einer Authenticator-App abgesichert. Beim Login wird zusätzlich ein
            6-stelliger Code abgefragt.
          </Text>
          <Button variant="light" color="red" onClick={() => { setDisableOpen(true); setCode(""); setError(null); }}>
            2FA deaktivieren
          </Button>
        </Stack>
      ) : (
        <Stack gap="sm" align="flex-start">
          <Text size="sm" c="dimmed">
            Schütze dein Konto mit einer Authenticator-App (Google Authenticator, 1Password, Aegis …).
          </Text>
          <Button color="slate" loading={isPending && !setup} onClick={beginSetup}>
            2FA einrichten
          </Button>
        </Stack>
      )}

      {/* Enrollment modal */}
      <Modal opened={setup !== null} onClose={() => setSetup(null)} title="2FA einrichten" centered>
        {setup && (
          <Stack gap="sm" align="center">
            <Text size="sm" c="dimmed" ta="center">
              Scanne den QR-Code mit deiner Authenticator-App und gib dann den 6-stelligen Code ein.
            </Text>
            <Image src={setup.qrDataUrl} alt="2FA QR-Code" width={200} height={200} unoptimized />
            <Text size="xs" c="dimmed" ta="center">
              Manuell: <Code>{setup.secret}</Code>
            </Text>
            <PinInput length={6} type="number" oneTimeCode value={code} onChange={setCode} onComplete={confirm} />
            {error && (
              <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light" w="100%">
                {error}
              </Alert>
            )}
            <Button color="slate" fullWidth loading={isPending} disabled={code.length !== 6} onClick={confirm}>
              Aktivieren
            </Button>
          </Stack>
        )}
      </Modal>

      {/* Disable modal */}
      <Modal opened={disableOpen} onClose={() => setDisableOpen(false)} title="2FA deaktivieren" centered>
        <Stack gap="sm" align="center">
          <Text size="sm" c="dimmed" ta="center">
            Gib zur Bestätigung einen aktuellen Code aus deiner Authenticator-App ein.
          </Text>
          <PinInput length={6} type="number" oneTimeCode value={code} onChange={setCode} onComplete={disable} />
          {error && (
            <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light" w="100%">
              {error}
            </Alert>
          )}
          <Button color="red" fullWidth loading={isPending} disabled={code.length !== 6} onClick={disable}>
            2FA deaktivieren
          </Button>
        </Stack>
      </Modal>
    </Card>
  );
}
