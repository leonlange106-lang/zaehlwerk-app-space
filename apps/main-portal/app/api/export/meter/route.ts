import { type NextRequest, NextResponse } from "next/server";
import { BACKUP_APP_ID, BACKUP_SCHEMA_VERSION, prisma } from "@zaehlwerk/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "zaehler";
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Parameter „id“ fehlt." }, { status: 400 });
  }

  const zaehler = await prisma.zaehler.findUnique({
    where: { id },
    include: {
      ablesungen: { orderBy: { datum: "asc" } },
      tarife: { orderBy: { gueltigAb: "asc" } },
      location: true,
    },
  });

  if (!zaehler) {
    return NextResponse.json({ error: "Zähler nicht gefunden." }, { status: 404 });
  }

  const { ablesungen, tarife, location, ...meterCore } = zaehler;
  const payload = {
    app: BACKUP_APP_ID,
    kind: "meter-export" as const,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    data: { zaehler: meterCore, ablesungen, tarife, location },
  };

  const datum = payload.generatedAt.slice(0, 10);
  const json = JSON.stringify(payload, null, 2);

  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="zaehlwerk_meter_${slugify(zaehler.name)}_${datum}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
