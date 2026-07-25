"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BetaBadge } from "@/app/components/ui/Badge";
import { Button } from "@/app/components/ui/Button";
import { Field, TextInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { Alert, IconChip, PageHeader } from "@/app/components/ui/primitives";
import { IconAlertCircle, IconCloudDownload, IconLink, IconWorldDownload } from "@tabler/icons-react";
import { parseShareLink } from "./lib/mgflasher";
import { setActiveLogId } from "./lib/log-store";
import { uploadLogs } from "./lib/log-api";

// Import a log by MGflasher share link. The URL is validated client-side for
// instant feedback, then the server route (`/api/apps/log-analyzer/fetch-remote`)
// does the authoritative validation + fetch + parse. On success we hand the
// parsed log to the analyzer via the session store and navigate there.

export function RemoteImportView() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientCheck = parseShareLink(url);
  const canSubmit = url.trim() !== "" && clientCheck.ok && !busy;
  const formatError = url.trim() !== "" && !clientCheck.ok ? clientCheck.reason : undefined;

  async function handleImport() {
    setError(null);
    const check = parseShareLink(url);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/apps/log-analyzer/fetch-remote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        source?: string;
        csv?: string;
      };
      if (!res.ok || !json.ok || !json.csv) {
        setError(json.error ?? `Import fehlgeschlagen (HTTP ${res.status}).`);
        return;
      }
      // Persist the imported log server-side, then hand it to the analyzer by id.
      const [created] = await uploadLogs([
        {
          name: `Log ${check.uuid.slice(0, 8)}`,
          csv: json.csv,
          source: "remote",
          sourceUrl: json.source ?? check.canonicalUrl,
        },
      ]);
      if (!created) {
        setError("Import konnte nicht gespeichert werden.");
        return;
      }
      setActiveLogId(created.id);
      router.push("/apps/log-analyzer");
    } catch {
      setError("Netzwerkfehler beim Import. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <IconChip size={44}>
          <IconWorldDownload size={22} stroke={1.6} />
        </IconChip>
        <PageHeader
          title="Remote-Import"
          badge={<BetaBadge />}
          description="Ein Log direkt über einen Share-Link laden — bisher nur MGflasher-Links."
        />
      </div>

      <Panel>
        <div className="flex flex-col gap-4">
          <Field label="MGflasher Share-Link" error={formatError}>
            {({ id, describedBy }) => (
              <div className="relative">
                <IconLink
                  size={16}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim"
                />
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  className="pl-10"
                  placeholder="https://logs.mgflasher.com/log/…"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.currentTarget.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit) void handleImport();
                  }}
                  data-testid="remote-url"
                />
              </div>
            )}
          </Field>

          {error && (
            <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
              {error}
            </Alert>
          )}

          <div className="flex justify-end">
            <Button variant="primary" disabled={!canSubmit} onClick={handleImport}>
              <IconCloudDownload size={16} />
              {busy ? "Wird importiert…" : "Prüfen & Importieren"}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Hinweise">
        <ul className="flex flex-col gap-1.5 text-sm text-dim">
          <li>
            Es werden ausschließlich Links von{" "}
            <strong className="text-ink">logs.mgflasher.com</strong> akzeptiert.
          </li>
          <li>Der Abruf erfolgt serverseitig; Zugriff nur für freigeschaltete Nutzer.</li>
          <li>Nach dem Import öffnet sich das Log direkt im Analyzer.</li>
        </ul>
      </Panel>
    </div>
  );
}
