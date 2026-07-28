import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { consumptionReadings, projectAnnualConsumption } from "@zaehlwerk/database/shared";
import { getZaehlerById, listDeletedAblesungen, listLocations } from "@/app/lib/zaehler-actions";
import { listActiveApiTokens } from "@/app/lib/api-token-actions";
import { ZaehlerDetail } from "./ZaehlerDetail";

export default async function ZaehlerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [zaehler, locations, apiTokens, headerList, geloeschte] = await Promise.all([
    getZaehlerById(id),
    listLocations(),
    listActiveApiTokens(),
    headers(),
    listDeletedAblesungen(id),
  ]);

  if (!zaehler) {
    notFound();
  }

  // Basis-URL für die generierten Snippets aus den Request-Headern ableiten —
  // stabil über SSR/Hydration und ohne Client-seitiges window.location.
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "dein-portal.example";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  // Nur der Bezug geht in die Hochrechnung.
  //
  // Eingespeiste Kilowattstunden sind kein Verbrauch. In dieselbe Reihe geworfen
  // ergeben sie keine Nettobilanz, sondern eine Folge von Sprüngen in beide
  // Richtungen — und eine Jahressumme samt Kosten daraus zu schätzen wäre grob
  // falsch, ohne dass man es der Zahl ansähe.
  const projection = projectAnnualConsumption({
    readings: consumptionReadings(zaehler.register, zaehler.ablesungen),
    kategorie: zaehler.kategorie,
    einheit: zaehler.einheit,
    tarife: zaehler.tarife,
    // Ohne die Faktoren blieben die hochgerechneten Gaskosten leer — richtig,
    // aber unnoetig, denn hier sind sie ja geladen.
    gasFaktoren: zaehler.umrechnungsfaktoren,
  });

  return (
    <ZaehlerDetail
      zaehler={zaehler}
      locations={locations}
      apiTokens={apiTokens}
      origin={origin}
      projection={projection}
      geloeschte={geloeschte}
    />
  );
}
