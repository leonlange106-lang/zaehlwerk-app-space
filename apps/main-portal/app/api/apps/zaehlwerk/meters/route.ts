import { NextResponse } from "next/server";
import { prisma } from "@zaehlwerk/database";
import { denyUnlessAppAccess } from "@/app/lib/api-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Meter names for the navigation menu's Zähler submenu.
//
// Deliberately its own endpoint rather than reusing `listZaehler()`: that one
// includes every reading of every meter because the pages that call it need the
// history, and the menu needs four columns. It is also fetched on demand — the
// menu asks for this the first time you open the Zähler level, so a page you
// never navigate from costs nothing, and the root layout stays free of a DB
// query on every single request across the whole portal.

export interface MenuMeter {
  id: string;
  name: string;
  einheit: string;
  farbe: string;
}

export async function GET() {
  const denied = await denyUnlessAppAccess("zaehlwerk");
  if (denied) return denied;

  const meters = await prisma.zaehler.findMany({
    where: { aktiv: true },
    orderBy: { sortIndex: "asc" },
    select: { id: true, name: true, einheit: true, farbe: true },
  });

  return NextResponse.json({ meters }, { headers: { "Cache-Control": "no-store" } });
}
