import { listLocations, listZaehler } from "../lib/zaehler-actions";
import { ZaehlerManager } from "./ZaehlerManager";

export default async function ZaehlerPage() {
  const [zaehlerList, locations] = await Promise.all([listZaehler(), listLocations()]);

  return <ZaehlerManager zaehlerList={zaehlerList} locations={locations} />;
}
