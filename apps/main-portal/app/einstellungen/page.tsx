import { listLocations } from "../lib/zaehler-actions";
import { getCurrentVersionInfo } from "../lib/version";
import { EinstellungenView } from "./EinstellungenView";

export const dynamic = "force-dynamic";

export default async function EinstellungenPage() {
  const [locations, versionInfo] = await Promise.all([listLocations(), getCurrentVersionInfo()]);

  return <EinstellungenView locations={locations} versionInfo={versionInfo} />;
}
