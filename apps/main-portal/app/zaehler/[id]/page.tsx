import { notFound } from "next/navigation";
import { getZaehlerById, listLocations } from "../../lib/zaehler-actions";
import { ZaehlerDetail } from "./ZaehlerDetail";

export default async function ZaehlerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [zaehler, locations] = await Promise.all([getZaehlerById(id), listLocations()]);

  if (!zaehler) {
    notFound();
  }

  return <ZaehlerDetail zaehler={zaehler} locations={locations} />;
}
