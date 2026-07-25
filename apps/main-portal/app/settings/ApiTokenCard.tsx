"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconAlertCircle, IconKey, IconPlus, IconTrash } from "@tabler/icons-react";
import type { ApiTokenSummary } from "@/app/lib/api-token-actions";
import { createApiToken, deleteApiToken } from "@/app/lib/api-token-actions";
import { Button } from "@/app/components/ui/Button";
import { CopyButton } from "@/app/components/ui/CopyButton";
import { Field, Select, SelectShell, TextInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
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
  { value: "30", label: "30 Tage" },
  { value: "90", label: "90 Tage" },
  { value: "365", label: "1 Jahr" },
];

export function ApiTokenCard({ tokens }: { tokens: ApiTokenSummary[] }) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  // Snapshot "now" once (lazy init) — calling Date.now() during render is impure.
  const [now] = useState(() => Date.now());

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createApiToken(name.trim(), Number(expiry) || null);
      if (result.success) {
        setCreatedToken(result.token);
        setName("");
        setExpiry("0");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove(id: string, tokenName: string) {
    if (
      !window.confirm(
        `Token „${tokenName}" wirklich löschen? Skripte, die ihn nutzen, verlieren den Zugriff.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteApiToken(id);
      toast.show({
        tone: result.success ? "ok" : "risk",
        title: result.success ? "Token gelöscht" : "Löschen fehlgeschlagen",
        message: result.success ? undefined : (result.error ?? undefined),
      });
      if (result.success) router.refresh();
    });
  }

  return (
    <Panel
      title="API-Zugriff · Personal Access Tokens"
      icon={<IconKey size={17} stroke={1.7} />}
      description={
        <>
          Tokens erlauben externen Skripten / Smart-Home-Geräten (Home Assistant, ESP32) den Zugriff
          auf die Export- und Backup-Endpunkte per <Code>Authorization: Bearer zw_pat_…</Code> — ohne
          Web-Login.
        </>
      }
    >
      {tokens.length > 0 && (
        <TableScroll className="mb-6">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Erstellt</Th>
                <Th>Zuletzt genutzt</Th>
                <Th>Läuft ab</Th>
                <Th className="text-right">Aktion</Th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => {
                const expired = token.expiresAt !== null && token.expiresAt.getTime() < now;
                return (
                  <tr key={token.id} className="last:[&>td]:border-0">
                    <Td className="font-medium">{token.name}</Td>
                    <Td className="whitespace-nowrap text-dim">
                      {dateFormatter.format(token.createdAt)}
                    </Td>
                    <Td className="whitespace-nowrap text-dim">
                      {token.lastUsedAt ? dateFormatter.format(token.lastUsedAt) : "—"}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {token.expiresAt ? (
                        <span className={expired ? "text-risk" : "text-dim"}>
                          {dateFormatter.format(token.expiresAt)}
                          {expired ? " (abgelaufen)" : ""}
                        </span>
                      ) : (
                        <span className="text-dim">—</span>
                      )}
                    </Td>
                    <Td>
                      <span className="flex justify-end">
                        <Tooltip label="Löschen / Widerrufen">
                          <Button
                            variant="danger"
                            size="sm"
                            aria-label={`Token „${token.name}" löschen`}
                            onClick={() => remove(token.id, token.name)}
                          >
                            <IconTrash size={16} />
                          </Button>
                        </Tooltip>
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      )}

      <h3 className="mb-3 text-[13px] font-semibold">Neuen Token erstellen</h3>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name" className="min-w-50 flex-1">
          {({ id }) => (
            <TextInput
              id={id}
              placeholder="z. B. Home Assistant"
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

      {/* The plaintext token exists exactly once, here. */}
      <ResponsiveDialog
        opened={createdToken !== null}
        onClose={() => setCreatedToken(null)}
        title="Token erstellt"
        footer={
          <Button type="button" onClick={() => setCreatedToken(null)}>
            Fertig
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Alert tone="watch" icon={<IconAlertCircle size={16} />}>
            Kopiere den Token jetzt — er wird <strong>nur dieses eine Mal</strong> angezeigt und kann
            danach nicht mehr eingesehen werden.
          </Alert>
          <CodeBlock className="whitespace-pre-wrap break-all">{createdToken}</CodeBlock>
          <CopyButton value={createdToken ?? ""} full />
          <p className="text-xs text-dim">
            Verwendung: <Code>Authorization: Bearer {"<token>"}</Code>
          </p>
        </div>
      </ResponsiveDialog>
    </Panel>
  );
}
