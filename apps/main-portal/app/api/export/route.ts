import type { NextRequest } from "next/server";
import { prisma } from "@zaehlwerk/database";

export const dynamic = "force-dynamic";

function csvEscape(value: string): string {
  if (/[;"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "export";
}

export async function GET(request: NextRequest) {
  const zaehlerId = request.nextUrl.searchParams.get("zaehlerId");

  const ablesungen = await prisma.ablesung.findMany({
    where: zaehlerId ? { zaehlerId } : undefined,
    orderBy: [{ zaehlerId: "asc" }, { datum: "asc" }],
    include: { zaehler: true },
  });

  const header = ["Zaehler", "Kategorie", "Datum", "Zaehlerstand", "Einheit", "Kosten", "Quelle"];
  const rows = ablesungen.map((ablesung) =>
    [
      ablesung.zaehler.name,
      ablesung.zaehler.kategorie,
      ablesung.datum.toISOString().slice(0, 10),
      ablesung.wert.toString(),
      ablesung.zaehler.einheit,
      ablesung.kosten != null ? ablesung.kosten.toString() : "",
      ablesung.quelle,
    ]
      .map((value) => csvEscape(value))
      .join(";"),
  );

  const bom = "﻿";
  const csv = `${bom}${[header.join(";"), ...rows].join("\n")}\n`;
  const filenameSuffix = zaehlerId ? slugify(ablesungen[0]?.zaehler.name ?? zaehlerId) : "alle-zaehler";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ablesungen-${filenameSuffix}.csv"`,
    },
  });
}
