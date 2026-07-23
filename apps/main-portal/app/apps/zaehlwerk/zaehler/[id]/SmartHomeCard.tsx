"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  CopyButton,
  Divider,
  Group,
  SegmentedControl,
  Select,
  SimpleGrid,
  Text,
  Title,
} from "@mantine/core";
import {
  IconApi,
  IconBulb,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconInfoCircle,
} from "@tabler/icons-react";
import type { SmartHomeTip } from "./smart-home-tips";
import { buildSnippet, type SnippetKind } from "./smart-home-snippets";

export interface SmartHomeTokenOption {
  id: string;
  name: string;
}

const SNIPPET_OPTIONS: { value: SnippetKind; label: string }[] = [
  { value: "curl", label: "cURL / Webhook" },
  { value: "homeassistant", label: "Home Assistant" },
  { value: "nodered", label: "Node-RED" },
];

const NO_TOKEN = "__none__";

// Fertige Blueprints/Gerätevorlagen liegen versioniert im Repo.
const HA_DOCS_URL =
  "https://github.com/leonlange106-lang/zaehlwerk-app-space/tree/main/docs/integrations/home-assistant";

export function SmartHomeCard({
  meterId,
  meterName,
  tips,
  tokens,
  origin,
}: {
  meterId: string;
  meterName: string;
  tips: SmartHomeTip[];
  tokens: SmartHomeTokenOption[];
  origin: string;
}) {
  const [kind, setKind] = useState<SnippetKind>("curl");
  const [selectedToken, setSelectedToken] = useState<string>(
    tokens[0]?.name ?? NO_TOKEN,
  );

  // Der Klartext-Token kann aus Sicherheitsgründen nie erneut angezeigt werden
  // (nur SHA-256-Hash gespeichert). Wir betten daher einen klar markierten
  // Platzhalter ein, der auf den gewählten Token verweist.
  const tokenPlaceholder =
    selectedToken === NO_TOKEN ? "DEIN_ZW_PAT_TOKEN" : `<WERT_VON_${selectedToken}>`;

  const snippet = useMemo(
    () =>
      buildSnippet(kind, {
        origin,
        meterId,
        meterName,
        token: tokenPlaceholder,
      }),
    [kind, origin, meterId, meterName, tokenPlaceholder],
  );

  const tokenData = [
    ...tokens.map((token) => ({ value: token.name, label: token.name })),
    { value: NO_TOKEN, label: "— Platzhalter —" },
  ];

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="sm">
        <IconBulb size={18} stroke={1.6} />
        <Title order={4}>Smart Home & Automatische Auslesung</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Empfehlungen zur automatischen Erfassung dieses Zählers und fertige Snippets, um Zählerstände
        per API an dieses Portal zu übertragen.
      </Text>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        {tips.map((tip) => (
          <div key={tip.title}>
            <Text size="sm" fw={600}>
              {tip.title}
            </Text>
            <Text size="xs" c="dimmed">
              {tip.description}
            </Text>
            {tip.link && (
              <Anchor href={tip.link} target="_blank" rel="noopener noreferrer" size="xs">
                <Group gap={4} wrap="nowrap" mt={2}>
                  Mehr erfahren
                  <IconExternalLink size={12} />
                </Group>
              </Anchor>
            )}
          </div>
        ))}
      </SimpleGrid>

      <Divider my="md" />

      <Group gap="xs" mb="xs">
        <IconApi size={16} stroke={1.6} />
        <Title order={5}>Snippet-Generator</Title>
        <Badge variant="light" color="slate" size="sm">
          POST /api/v1/readings
        </Badge>
      </Group>

      {tokens.length === 0 ? (
        <Alert color="yellow" icon={<IconInfoCircle size={16} />} variant="light" mb="sm">
          Du hast noch keinen aktiven Personal Access Token. Erstelle einen unter{" "}
          <Anchor component={Link} href="/settings">
            Einstellungen → API-Zugriff
          </Anchor>
          , um Zählerstände automatisch zu übertragen.
        </Alert>
      ) : (
        <Alert color="blue" icon={<IconInfoCircle size={16} />} variant="light" mb="sm">
          Der Token-Wert wird aus Sicherheitsgründen nur einmalig bei Erstellung angezeigt. Ersetze
          den Platzhalter <Code>{tokenPlaceholder}</Code> im Snippet durch den geheimen Wert deines
          Tokens.
        </Alert>
      )}

      <Group gap="sm" mb="sm" align="flex-end" wrap="wrap">
        <SegmentedControl
          value={kind}
          onChange={(value) => setKind(value as SnippetKind)}
          data={SNIPPET_OPTIONS}
          size="xs"
        />
        <Select
          label="Token"
          size="xs"
          data={tokenData}
          value={selectedToken}
          onChange={(value) => setSelectedToken(value ?? NO_TOKEN)}
          allowDeselect={false}
          w={200}
        />
      </Group>

      {kind === "homeassistant" && (
        <Text size="xs" c="dimmed" mb="xs">
          Fertiger Home-Assistant-Blueprint und Gerätevorlagen (ESPHome, Tasmota, Shelly):{" "}
          <Anchor href={HA_DOCS_URL} target="_blank" rel="noopener noreferrer">
            <Group gap={4} wrap="nowrap" component="span" display="inline-flex">
              docs/integrations/home-assistant
              <IconExternalLink size={12} />
            </Group>
          </Anchor>
        </Text>
      )}

      <div style={{ position: "relative" }}>
        <CopyButton value={snippet}>
          {({ copied, copy }) => (
            <Button
              size="compact-xs"
              variant="light"
              color={copied ? "green" : "slate"}
              leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              onClick={copy}
              style={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
            >
              {copied ? "Kopiert" : "Kopieren"}
            </Button>
          )}
        </CopyButton>
        <Code block style={{ maxHeight: 360, overflow: "auto", paddingTop: 40 }}>
          {snippet}
        </Code>
      </div>
    </Card>
  );
}
