import { IconAlertTriangle, IconInfoCircle, IconWorld } from "@tabler/icons-react";
import { Panel } from "@/app/components/ui/Panel";
import { Alert, Code, Divider, Table, TableScroll, Td, Th } from "@/app/components/ui/primitives";
import { fetchTraffic } from "@/app/lib/cloudflare-analytics";

// Zugriffe, gemessen an der Kante. Was Access abgewiesen oder die WAF blockiert
// hat, sieht die App nie — deshalb steht das hier und nicht in einer eigenen
// Zaehlung der Anwendung.

function fmtNumber(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export async function AdminTrafficSection() {
  const result = await fetchTraffic(14);

  if (!result.ok) {
    return (
      <Panel title="Zugriffe & Verkehr" icon={<IconWorld size={17} stroke={1.7} />}>
        {result.reason === "not-configured" ? (
          // Kein Fehler: eine Instanz ohne Cloudflare ist ein normaler
          // Betriebsfall. Deshalb eine Anleitung statt einer Warnung.
          <Alert icon={<IconInfoCircle size={16} />}>
            <strong className="text-ink">Noch nicht eingerichtet.</strong> Diese Zahlen kommen von
            Cloudflare, nicht aus der Anwendung — sie zeigen auch, was gar nicht bis hierher
            durchgekommen ist. Dafür braucht die Instanz einen eigenen API-Token mit{" "}
            <Code>Analytics: Read</Code> auf der Zone:
            <span className="mt-2 block">
              <Code>CLOUDFLARE_ANALYTICS_TOKEN</Code>, <Code>CLOUDFLARE_ZONE_ID</Code> und optional{" "}
              <Code>CLOUDFLARE_ZONE_NAME</Code> in die <Code>.env</Code>, dann neu starten.
            </span>
            <span className="mt-2 block text-[11px]">
              Bewusst ein eigener Token: der Tunnel-Token kann nur Tunnel, und ein Token mit mehr
              Rechten als Lesen hätte hier nichts zu suchen.
            </span>
          </Alert>
        ) : (
          <Alert tone="risk" role="alert" icon={<IconAlertTriangle size={16} />}>
            <strong className="text-ink">Abfrage fehlgeschlagen.</strong> {result.message}
            <span className="mt-1 block text-[11px]">
              Häufigste Ursache: der Token ist abgelaufen oder hat nicht die Berechtigung{" "}
              <Code>Analytics: Read</Code> auf dieser Zone.
            </span>
          </Alert>
        )}
      </Panel>
    );
  }

  const { totals, daily, topCountries, since, until } = result.data;
  const peak = daily.reduce((max, day) => Math.max(max, day.requests), 0);

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Zugriffe & Verkehr"
        icon={<IconWorld size={17} stroke={1.7} />}
        description={`${since} bis ${until}, an Cloudflares Kante gemessen`}
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Anfragen" value={fmtNumber(totals.requests)} />
          <Stat label="Seitenaufrufe" value={fmtNumber(totals.pageViews)} />
          <Stat label="Besucher" value={fmtNumber(totals.uniques)} />
          <Stat label="Übertragen" value={fmtBytes(totals.bytes)} />
          <Stat
            label="Abgewehrt"
            value={fmtNumber(totals.threats)}
            hint={totals.threats > 0 ? "von WAF/Bot-Schutz" : undefined}
          />
        </div>

        <Divider className="my-4" />

        {/* Balken aus reinem CSS statt eines Diagramms: Recharts liegt in einem
            eigenen ~350-KB-Bundle, und vierzehn Werte rechtfertigen das nicht.
            Die Zahl steht daneben, der Balken ist die Zugabe — nicht die
            einzige Informationsquelle. */}
        <p className="legend-label mb-2">Anfragen je Tag</p>
        <div className="flex flex-col gap-1">
          {daily.map((day) => (
            <div key={day.date} className="flex items-center gap-3">
              <span className="w-20 flex-none text-[11px] text-dim">{day.date.slice(5)}</span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-inset">
                <span
                  className="accent-gradient block h-full rounded-full"
                  style={{ width: peak > 0 ? `${Math.max(2, (day.requests / peak) * 100)}%` : "0%" }}
                />
              </span>
              <span className="readout w-16 flex-none text-right text-[11px]">
                {fmtNumber(day.requests)}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Herkunft" icon={<IconWorld size={17} stroke={1.7} />}>
        {topCountries.length === 0 ? (
          <p className="py-4 text-sm text-dim">Keine Zugriffe im Zeitraum.</p>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>Land</Th>
                  <Th>Anfragen</Th>
                  <Th>Anteil</Th>
                </tr>
              </thead>
              <tbody>
                {topCountries.map((entry) => (
                  <tr key={entry.country}>
                    <Td>{entry.country}</Td>
                    <Td>{fmtNumber(entry.requests)}</Td>
                    <Td>
                      {totals.requests > 0
                        ? `${((entry.requests / totals.requests) * 100).toFixed(1)} %`
                        : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
        {/* Cloudflare liefert Laender, keine Adressen. Das ist keine Luecke,
            sondern deren Datenschutz-Grenze — und fuer die Frage "wer klopft an"
            reicht es. */}
        <p className="mt-3 text-[11px] text-dim">
          Cloudflare gibt Herkunftsländer aus, keine einzelnen IP-Adressen. Wer eine bestimmte
          Adresse verfolgen will, findet sie in den Zugriffsprotokollen im Cloudflare-Dashboard.
        </p>
      </Panel>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="legend-label">{label}</p>
      <p className="readout mt-0.5 text-sm">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-dim">{hint}</p>}
    </div>
  );
}
