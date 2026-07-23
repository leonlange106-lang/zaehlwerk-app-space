import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getZaehlerById, listLocations } from "../../lib/zaehler-actions";
import { listActiveApiTokens } from "../../lib/api-token-actions";
import { ZaehlerDetail } from "./ZaehlerDetail";

export default async function ZaehlerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [zaehler, locations, apiTokens, headerList] = await Promise.all([
    getZaehlerById(id),
    listLocations(),
    listActiveApiTokens(),
    headers(),
  ]);

  if (!zaehler) {
    notFound();
  }

  // Basis-URL für die generierten Snippets aus den Request-Headern ableiten —
  // stabil über SSR/Hydration und ohne Client-seitiges window.location.
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "dein-portal.example";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  return (
    <ZaehlerDetail zaehler={zaehler} locations={locations} apiTokens={apiTokens} origin={origin} />
  );
}
