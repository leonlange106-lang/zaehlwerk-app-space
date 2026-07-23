import { BACKUP_APP_ID, BACKUP_SCHEMA_VERSION, prisma } from "@zaehlwerk/database";
import { authenticateApiRequest, unauthorizedResponse } from "../../../lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await authenticateApiRequest(request))) return unauthorizedResponse();

  const [locations, zaehler, ablesungen, tarife] = await Promise.all([
    prisma.location.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.zaehler.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.ablesung.findMany({ orderBy: { datum: "asc" } }),
    prisma.tarif.findMany({ orderBy: { gueltigAb: "asc" } }),
  ]);

  const backup = {
    app: BACKUP_APP_ID,
    kind: "full-backup" as const,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    data: { locations, zaehler, ablesungen, tarife },
  };

  // JSON.stringify serializes Date fields to ISO strings, matching the schema.
  const json = JSON.stringify(backup, null, 2);
  const datum = backup.generatedAt.slice(0, 10);

  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="zaehlwerk_backup_${datum}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
