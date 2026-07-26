"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/app/components/ui/Badge";
import { CopyButton } from "@/app/components/ui/CopyButton";
import { Field, Select, SelectShell } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { Alert, Code, CodeBlock, Divider, SegmentedControl } from "@/app/components/ui/primitives";
import {
  IconApi,
  IconBulb,
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
    <Panel
      title="Smart Home & Automatische Auslesung"
      icon={<IconBulb size={17} stroke={1.7} />}
      description="Empfehlungen zur automatischen Erfassung dieses Zählers und fertige Snippets, um Zählerstände per API an dieses Portal zu übertragen."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {tips.map((tip) => (
          <div key={tip.title} className="min-w-0">
            <p className="text-sm font-semibold">{tip.title}</p>
            <p className="mt-0.5 text-xs text-dim">{tip.description}</p>
            {tip.link && (
              <a
                href={tip.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
              >
                Mehr erfahren
                <IconExternalLink size={12} />
              </a>
            )}
          </div>
        ))}
      </div>

      <Divider className="my-5" />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <IconApi size={16} stroke={1.7} className="flex-none text-dim" />
        <h3 className="text-sm font-semibold">Snippet-Generator</h3>
        <Badge>POST /api/v1/readings</Badge>
      </div>

      {tokens.length === 0 ? (
        <Alert tone="watch" icon={<IconInfoCircle size={16} />} className="mb-4">
          Du hast noch keinen aktiven Personal Access Token. Erstelle einen unter{" "}
          {/* Straight to the group that holds the token card. Since the settings
              were split, /settings is an index — landing there would name a card
              and then not show it. */}
          <Link
            href="/settings/integrationen"
            className="text-accent underline-offset-2 hover:underline"
          >
            Einstellungen → Integrationen
          </Link>
          , um Zählerstände automatisch zu übertragen.
        </Alert>
      ) : (
        <Alert icon={<IconInfoCircle size={16} />} className="mb-4">
          Der Token-Wert wird aus Sicherheitsgründen nur einmalig bei Erstellung angezeigt. Ersetze
          den Platzhalter <Code>{tokenPlaceholder}</Code> im Snippet durch den geheimen Wert deines
          Tokens.
        </Alert>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SegmentedControl
          className="sm:w-auto sm:min-w-72"
          label="Snippet-Format"
          value={kind}
          onChange={(value) => setKind(value as SnippetKind)}
          options={SNIPPET_OPTIONS.map((o) => ({ value: o.value as SnippetKind, label: o.label }))}
        />
        <Field label="Token" className="w-52">
          {({ id }) => (
            <SelectShell>
              <Select
                id={id}
                value={selectedToken}
                onChange={(event) => setSelectedToken(event.currentTarget.value)}
              >
                {tokenData.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </SelectShell>
          )}
        </Field>
      </div>

      {kind === "homeassistant" && (
        <p className="mb-2 text-xs text-dim">
          Fertiger Home-Assistant-Blueprint und Gerätevorlagen (ESPHome, Tasmota, Shelly):{" "}
          <a
            href={HA_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
          >
            docs/integrations/home-assistant
            <IconExternalLink size={12} />
          </a>
        </p>
      )}

      <div className="relative">
        <CopyButton value={snippet} size="sm" className="absolute right-2 top-2 z-10" />
        <CodeBlock className="max-h-90 overflow-auto pt-12">{snippet}</CodeBlock>
      </div>
    </Panel>
  );
}
