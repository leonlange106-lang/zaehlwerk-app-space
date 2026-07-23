"use client";

// Route-segment error boundary. Catches render/data errors thrown by any page
// under the root layout and shows a recoverable fallback instead of a blank
// screen. The Mantine provider from the layout is still mounted here, so we can
// use the design system. Keep the message generic — never surface raw error
// details (they can leak internals) beyond the digest, which is safe to show.

import { useEffect } from "react";
import { Button, Center, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the server/browser console for diagnostics; users only see the
    // friendly card below.
    console.error("[route-error]", error);
  }, [error]);

  return (
    <Center mih="60vh" p="lg">
      <Stack align="center" gap="md" maw={440}>
        <ThemeIcon size={56} radius="md" variant="light" color="red">
          <IconAlertTriangle size={30} stroke={1.6} />
        </ThemeIcon>
        <Title order={3} ta="center">
          Etwas ist schiefgelaufen
        </Title>
        <Text c="dimmed" ta="center" size="sm">
          Diese Ansicht konnte nicht geladen werden. Du kannst es erneut versuchen — die übrigen
          Daten sind davon nicht betroffen.
        </Text>
        {error.digest && (
          <Text c="dimmed" size="xs" ff="monospace">
            Referenz: {error.digest}
          </Text>
        )}
        <Group>
          <Button
            leftSection={<IconRefresh size={16} />}
            color="slate"
            onClick={() => reset()}
          >
            Erneut versuchen
          </Button>
        </Group>
      </Stack>
    </Center>
  );
}
