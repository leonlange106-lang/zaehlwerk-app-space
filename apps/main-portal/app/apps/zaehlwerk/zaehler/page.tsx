import { listLocations, listZaehler } from "@/app/lib/zaehler-actions";
import { ZaehlerManager } from "./ZaehlerManager";

export const dynamic = "force-dynamic";

export default async function ZaehlerPage() {
  const [zaehlerList, locations] = await Promise.all([listZaehler(), listLocations()]);

  return <ZaehlerManager zaehlerList={zaehlerList} locations={locations} />;
}
