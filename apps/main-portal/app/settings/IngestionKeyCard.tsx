"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconAlertCircle, IconPlus, IconRobot, IconTrash } from "@tabler/icons-react";
import type { IngestionKeySummary } from "@/app/lib/ingestion-key-actions";
import { createIngestionKey, revokeIngestionKey } from "@/app/lib/ingestion-key-actions";
import { BetaBadge } from "@/app/components/ui/Badge";
import { Button } from "@/app/components/ui/Button";
import { CopyButton } from "@/app/components/ui/CopyButton";
import { Field, Select, SelectShell, TextInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import { StatusBadge } from "@/app/components/ui/StatusBadge";
import { Tooltip } from "@/app/components/ui/Tooltip";
import { useToast } from "@/app/components/ui/Toast";
import { Alert, Code, CodeBlock, Table, TableScroll, Td, Th } from "@/app/components/ui/primitives";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const expiryOptions = [
  { value: "0", label: "Läuft nie ab" },
  { value: "90", label: "90 Tage" },
  { value: "365", label: "1 Jahr" },
];

export function IngestionKeyCard({ keys }: { keys: IngestionKeySummary[] }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createIngestionKey(name.trim(), Number(expiry) || null);
      if (result.success) {
        setCreatedKey(result.key);
        setName("");
        setExpiry("0");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function revoke(id: string, keyName: string) {
    if (
      !window.confirm(
        `Key „${keyName}" widerrufen? Automatische Importe damit verlieren sofort den Zugriff.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await revokeIngestionKey(id);
      toast.show({
        tone: result.success ? "ok" : "risk",
        title: result.success ? "Key widerrufen" : "Widerrufen fehlgeschlagen",
        message: result.success ? undefined : (result.error ?? undefined),
      });
      if (result.success) router.refresh();
    });
  }

  return (
    <Panel
      title="Automatische Log-Ingestion · API-Keys"
      icon={<IconRobot size={17} stroke={1.7} />}
      action={<BetaBadge />}
      description={
        <>
          Keys erlauben Home Assistant, cURL oder Sync-Skripten den automatischen Log-Upload an{" "}
          <Code>POST /api/v1/logs/ingest</Code> per <Code>X-API-Key</Code>-Header — ohne Web-Login.
        </>
      }
    >
      {keys.length > 0 && (
        <TableScroll className="mb-6">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Erstellt</Th>
                <Th>Zuletzt genutzt</Th>
                <Th>Status</Th>
                <Th className="text-right">Aktion</Th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const expired = key.expiresAt !== null && key.expiresAt.getTime() < now;
                const inactive = key.revoked || expired;
                return (
                  <tr key={key.id} className="last:[&>td]:border-0">
                    <Td className="font-medium">{key.name}</Td>
                    <Td className="whitespace-nowrap text-dim">
                      {dateFormatter.format(key.createdAt)}
                    </Td>
                    <Td className="whitespace-nowrap text-dim">
                      {key.lastUsedAt ? dateFormatter.format(key.lastUsedAt) : "—"}
                    </Td>
                    <Td>
                      <StatusBadge
                        tone={inactive ? "risk" : "ok"}
                        label={key.revoked ? "widerrufen" : expired ? "abgelaufen" : "aktiv"}
                        size="xs"
                      />
                    </Td>
                    <Td>
                      <span className="flex justify-end">
                        {!key.revoked && (
                          <Tooltip label="Widerrufen">
                            <Button
                              variant="danger"
                              size="sm"
                              aria-label={`Key „${key.name}" widerrufen`}
                              onClick={() => revoke(key.id, key.name)}
                            >
                              <IconTrash size={16} />
                            </Button>
                          </Tooltip>
                        )}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      )}

      <h3 className="mb-3 text-[13px] font-semibold">Neuen Key erstellen</h3>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name" className="min-w-50 flex-1">
          {({ id }) => (
            <TextInput
              id={id}
              placeholder="z. B. Home Assistant Watch-Folder"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label="Gültigkeit" className="w-40">
          {({ id }) => (
            <SelectShell>
              <Select
                id={id}
                value={expiry}
                onChange={(event) => setExpiry(event.currentTarget.value)}
              >
                {expiryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </SelectShell>
          )}
        </Field>
        <Button variant="primary" disabled={isPending || !name.trim()} onClick={create}>
          <IconPlus size={16} />
          {isPending ? "Wird erstellt…" : "Erstellen"}
        </Button>
      </div>
      {error && (
        <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />} className="mt-4">
          {error}
        </Alert>
      )}

      <ResponsiveDialog
        opened={createdKey !== null}
        onClose={() => setCreatedKey(null)}
        title="API-Key erstellt"
        footer={
          <Button type="button" onClick={() => setCreatedKey(null)}>
            Fertig
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Alert tone="watch" icon={<IconAlertCircle size={16} />}>
            Kopiere den Key jetzt — er wird <strong>nur dieses eine Mal</strong> angezeigt.
          </Alert>
          <CodeBlock className="whitespace-pre-wrap break-all">{createdKey}</CodeBlock>
          <CopyButton value={createdKey ?? ""} full />
          <p className="text-xs text-dim">
            Verwendung:{" "}
            <Code>curl -H &quot;X-API-Key: {"<key>"}&quot; -F file=@log.csv …/api/v1/logs/ingest</Code>
          </p>
        </div>
      </ResponsiveDialog>
    </Panel>
  );
}
