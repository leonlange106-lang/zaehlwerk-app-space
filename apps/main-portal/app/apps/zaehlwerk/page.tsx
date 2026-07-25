import {
  IconArrowUpRight,
  IconCalendarStats,
  IconClipboardList,
  IconMapPin,
  IconPlus,
  IconStack2,
} from "@tabler/icons-react";
import { ButtonLink } from "@/app/components/ui/Button";
import { KpiRail } from "@/app/components/ui/KpiRail";
import {
  getConsumptionSummary,
  listLocations,
  listRecentAblesungen,
  listZaehler,
} from "@/app/lib/zaehler-actions";

// Reads live data from the database on every request — must not be statically
// prerendered at build time (there's no reachable DB then, and a static snapshot
// would go stale the moment someone adds a reading).
export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days < 30) return `vor ${days} Tag${days === 1 ? "" : "en"}`;
  return dateFormatter.format(date);
}

/** Panel: the standard container. Title row optional, body is whatever you pass. */
function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel flex flex-col p-5 ${className ?? ""}`}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export default async function DashboardPage() {
  const [zaehlerList, locations, recentAblesungen, consumptionSummary] = await Promise.all([
    listZaehler(),
    listLocations(),
    listRecentAblesungen(6),
    getConsumptionSummary(),
  ]);

  const totalAblesungen = zaehlerList.reduce((sum, zaehler) => sum + zaehler.ablesungen.length, 0);
  const lastReadingDate = recentAblesungen[0]?.datum ?? null;

  // Headline numbers for the sticky micro-KPI rail. On a phone this is one
  // horizontally scrollable row pinned under the header; from `sm` up it lays
  // itself out as a four-column grid. Each tile carries its own hue so the row
  // reads as four distinct metrics rather than four boxes.
  const stats = [
    {
      key: "zaehler",
      label: "Aktive Zähler",
      value: String(zaehlerList.length),
      hint: "Strom, Gas, Wasser & mehr",
      icon: <IconStack2 size={18} stroke={1.7} />,
      accent: "var(--zw-accent)",
    },
    {
      key: "standorte",
      label: "Standorte",
      value: String(locations.length),
      hint: "erfasste Gebäude/Einheiten",
      icon: <IconMapPin size={18} stroke={1.7} />,
      accent: "#a78bfa",
    },
    {
      key: "ablesungen",
      label: "Ablesungen",
      value: String(totalAblesungen),
      hint: "über alle Zähler",
      icon: <IconClipboardList size={18} stroke={1.7} />,
      accent: "var(--zw-ok)",
    },
    {
      key: "letzte",
      label: "Letzte Ablesung",
      value: lastReadingDate ? dateFormatter.format(lastReadingDate) : "–",
      hint: lastReadingDate ? formatRelative(lastReadingDate) : "noch keine Daten",
      icon: <IconCalendarStats size={18} stroke={1.7} />,
      accent: "var(--zw-watch)",
    },
  ];

  // Longest bar sets the scale, so the shares stay comparable at a glance even
  // when the units differ (kWh next to m³).
  const peakConsumption = Math.max(1, ...consumptionSummary.map((e) => e.totalConsumption));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-dim">
            Überblick über Zähler, Verbrauch und die letzten Ablesungen.
          </p>
        </div>
        <ButtonLink
          href="/apps/zaehlwerk/zaehler"
          variant="primary"
          className="hidden sm:inline-flex"
        >
          <IconPlus size={16} stroke={2} />
          Zählerstand erfassen
        </ButtonLink>
      </div>

      <KpiRail items={stats} columns={4} label="Zählwerk-Kennzahlen" />

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel
          title="Letzte Aktivität"
          className="lg:col-span-2"
          action={
            <ButtonLink href="/apps/zaehlwerk/zaehler" variant="ghost" size="sm">
              Alle anzeigen
              <IconArrowUpRight size={15} stroke={1.8} />
            </ButtonLink>
          }
        >
          {recentAblesungen.length === 0 ? (
            <p className="py-6 text-center text-sm text-dim">Noch keine Ablesungen erfasst.</p>
          ) : (
            <ul className="flex flex-col">
              {recentAblesungen.map((ablesung) => (
                <li
                  key={ablesung.id}
                  className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0 last:pb-0"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden
                      className="size-2 flex-none rounded-full"
                      style={{ background: ablesung.zaehler.farbe }}
                    />
                    <span className="truncate text-sm">{ablesung.zaehler.name}</span>
                  </span>
                  <span className="flex flex-none items-center gap-4">
                    <span className="readout text-sm">
                      {numberFormatter.format(ablesung.wert)}{" "}
                      <span className="text-dim">{ablesung.zaehler.einheit}</span>
                    </span>
                    <span className="w-24 text-right text-xs text-dim">
                      {formatRelative(ablesung.datum)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Verbrauch je Zähler">
            {consumptionSummary.length === 0 ? (
              <p className="py-4 text-center text-sm text-dim">Noch keine Zähler angelegt.</p>
            ) : (
              <ul className="flex flex-col gap-3.5">
                {consumptionSummary.map((entry) => (
                  <li key={entry.zaehlerId} className="flex flex-col gap-1.5">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm">{entry.name}</span>
                      <span className="readout flex-none text-sm">
                        {numberFormatter.format(entry.totalConsumption)}{" "}
                        <span className="text-dim">{entry.einheit}</span>
                      </span>
                    </span>
                    {/* Share of the largest meter — the bar is the comparison, the
                        number is the fact. */}
                    <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-inset">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(3, (entry.totalConsumption / peakConsumption) * 100)}%`,
                          background: `linear-gradient(90deg, ${entry.farbe}, color-mix(in srgb, ${entry.farbe} 45%, transparent))`,
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Schnellzugriff">
            <div className="flex flex-col gap-2">
              <ButtonLink href="/apps/zaehlwerk/zaehler" align="start" full>
                Neuen Zähler anlegen
              </ButtonLink>
              <ButtonLink href="/apps/zaehlwerk/zaehler" align="start" full>
                Zählerstand erfassen
              </ButtonLink>
              <ButtonLink href="/apps/zaehlwerk/berichte" align="start" full>
                Berichte öffnen
              </ButtonLink>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
