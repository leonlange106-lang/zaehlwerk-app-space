import { authenticateApiRequest, unauthorizedResponse } from "../../../lib/api-auth";
import { buildFullBackup } from "../../../lib/backup-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await authenticateApiRequest(request))) return unauthorizedResponse();

  const backup = await buildFullBackup();

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
