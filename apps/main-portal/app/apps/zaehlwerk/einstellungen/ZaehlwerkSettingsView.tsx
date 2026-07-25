"use client";

import Link from "next/link";
import { Panel } from "@/app/components/ui/Panel";
import { PageHeader } from "@/app/components/ui/primitives";
import { IconChartBar, IconReceipt2, IconStack2 } from "@tabler/icons-react";
import type { listLocations } from "@/app/lib/zaehler-actions";
import { LocationsCard } from "./LocationsCard";

type LocationList = Awaited<ReturnType<typeof listLocations>>;

export function ZaehlwerkSettingsView({ locations }: { locations: LocationList }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Zählwerk – Einstellungen"
        description={
          <>
            App-spezifische Konfiguration: Standorte &amp; Zählergruppen, Tarife und Datenexporte.
            System- und Kontoeinstellungen liegen in den{" "}
            <Link href="/settings" className="text-accent underline-offset-2 hover:underline">
              Plattform-Einstellungen
            </Link>
            .
          </>
        }
      />

      <LocationsCard locations={locations} />

      <Panel title="Tarife" icon={<IconReceipt2 size={17} stroke={1.7} />}>
        <p className="text-sm text-dim">
          Tarife (Arbeits- &amp; Grundpreis, MwSt) werden je Zähler gepflegt – öffne dazu einen
          Zähler und verwalte seine Tarifperioden direkt in der Detailansicht.
        </p>
        <Link
          href="/apps/zaehlwerk/zaehler"
          className="mt-2 inline-block text-sm text-accent underline-offset-2 hover:underline"
        >
          Zu den Zählern →
        </Link>
      </Panel>

      <Panel title="Exporte & Importe" icon={<IconChartBar size={17} stroke={1.7} />}>
        <p className="mb-2 text-sm text-dim">App-Daten dieser Anwendung:</p>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex gap-2.5">
            <IconStack2 size={15} stroke={1.7} className="mt-0.5 flex-none text-dim" />
            <span>
              CSV- und PDF-Exporte je Zähler und Zeitraum erstellst du unter{" "}
              <Link
                href="/apps/zaehlwerk/berichte"
                className="text-accent underline-offset-2 hover:underline"
              >
                Berichte
              </Link>
              .
            </span>
          </li>
          <li className="flex gap-2.5">
            <IconStack2 size={15} stroke={1.7} className="mt-0.5 flex-none text-dim" />
            <span>
              Zählerstände importierst du direkt beim jeweiligen Zähler (Detailansicht → Import)
              bzw. beim Anlegen eines Zählers.
            </span>
          </li>
        </ul>
        <p className="mt-4 text-xs text-dim">
          Vollständige System-Backups (gesamte Datenbank) findest du in den
          Plattform-Einstellungen.
        </p>
      </Panel>
    </div>
  );
}
