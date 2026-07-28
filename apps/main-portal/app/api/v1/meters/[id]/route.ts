import { type NextRequest, NextResponse } from "next/server";
import { apiMeterPatchSchema, Prisma, prisma } from "@zaehlwerk/database";
import { authenticateApiRequest, unauthorizedResponse } from "../../../../lib/api-auth";
import { clientIdentifier, rateLimit } from "../../../../lib/rate-limit";
import { AUDIT_ACTIONS, recordAuditEvent } from "../../../../lib/audit";
import {
  fieldErrorsFromZod,
  forbiddenProblem,
  notFoundProblem,
  rateLimitedProblem,
  validationProblem,
} from "../../../../lib/api-problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Einen Zähler ändern oder stilllegen.
//
// DELETE ist hier die heikelste Methode im ganzen Projekt: An einem Zähler
// hängen seine Ablesungen per Cascade. Ein versehentliches DELETE löscht also
// nicht einen Datensatz, sondern eine Zeitreihe — und die ist, anders als ein
// Name, nicht wiederherstellbar. Deshalb sind hier zwei Dinge anders als sonst:
// Standardmäßig wird nur STILLGELEGT (`aktiv: false`), und wirklich gelöscht
// wird nur, wenn der Aufrufer `?purge=true` ausdrücklich verlangt und den
// Datenverlust damit bewusst in Kauf nimmt.

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const SELECT = {
  id: true,
  name: true,
  kategorie: true,
  einheit: true,
  farbe: true,
  icon: true,
  aktiv: true,
  sortIndex: true,
  locationId: true,
  stellen: true,
  ableseIntervallTage: true,
} as const;

type MeterRow = Prisma.ZaehlerGetPayload<{ select: typeof SELECT }>;

function serialize(meter: MeterRow) {
  return {
    id: meter.id,
    name: meter.name,
    category: meter.kategorie,
    unit: meter.einheit,
    color: meter.farbe,
    icon: meter.icon,
    active: meter.aktiv,
    sortIndex: meter.sortIndex,
    locationId: meter.locationId,
    digits: meter.stellen,
    readingIntervalDays: meter.ableseIntervallTage,
  };
}

async function guard(request: NextRequest) {
  const limit = rateLimit({
    key: `meter-write:${clientIdentifier(request)}`,
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (!limit.ok) return { response: rateLimitedProblem(limit.retryAfter) };

  const user = await authenticateApiRequest(request);
  if (!user) return { response: unauthorizedResponse() };
  return { user };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await guard(request);
  if (gate.response) return gate.response;

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationProblem(
      [{ field: "(body)", message: "Der Body ist kein gültiges JSON." }],
      "Der Body ist kein gültiges JSON.",
    );
  }

  const parsed = apiMeterPatchSchema.safeParse(body);
  if (!parsed.success) return validationProblem(fieldErrorsFromZod(parsed.error));

  const existing = await prisma.zaehler.findUnique({ where: { id }, select: SELECT });
  if (!existing) return notFoundProblem(`Kein Zähler mit der Id ${id}.`);

  const patch = parsed.data;
  // Nur genanntes Feld anfassen. `undefined` heißt „nicht erwähnt", `null` bei
  // `locationId`/`digits` heißt „ausdrücklich leeren" — die Unterscheidung ist
  // der Grund, warum das Schema dort `nullish` statt `optional` benutzt.
  const data: Prisma.ZaehlerUpdateInput = {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.category === undefined ? {} : { kategorie: patch.category }),
    ...(patch.unit === undefined ? {} : { einheit: patch.unit }),
    ...(patch.color === undefined ? {} : { farbe: patch.color }),
    ...(patch.icon === undefined ? {} : { icon: patch.icon }),
    ...(patch.active === undefined ? {} : { aktiv: patch.active }),
    ...(patch.digits === undefined ? {} : { stellen: patch.digits ?? null }),
    ...(patch.readingIntervalDays === undefined
      ? {}
      : { ableseIntervallTage: patch.readingIntervalDays }),
    ...(patch.locationId === undefined
      ? {}
      : patch.locationId === null
        ? { location: { disconnect: true } }
        : { location: { connect: { id: patch.locationId } } }),
  };

  let updated: MeterRow;
  try {
    updated = await prisma.zaehler.update({ where: { id }, data, select: SELECT });
  } catch (error) {
    // Ein Standort, den es nicht (mehr) gibt. Als 400 am Feld, nicht als 500 —
    // der Aufrufer hat einen Wert geschickt, nicht der Server einen Fehler.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return validationProblem(
        [{ field: "locationId", message: "Dieser Standort existiert nicht." }],
        "Dieser Standort existiert nicht.",
      );
    }
    console.error("[PATCH /api/v1/meters/[id]]", error);
    throw error;
  }

  void recordAuditEvent(
    AUDIT_ACTIONS.apiMeterUpdate,
    `${gate.user!.email} (${gate.user!.via})`,
    `Zähler ${id} (${updated.name}): ${Object.keys(data).join(", ") || "keine Änderung"}`,
  ).catch(() => {});

  return NextResponse.json({ meter: serialize(updated) });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await guard(request);
  if (gate.response) return gate.response;

  // Löschen ist Administratorensache. Ein Token mit Nutzerrechten darf Stände
  // melden und korrigieren — eine ganze Zeitreihe zu entfernen ist etwas
  // anderes, und ein durchgesickertes Automations-Token soll es nicht können.
  if (gate.user!.role !== "ADMIN") {
    return forbiddenProblem("Einen Zähler zu entfernen ist Administratoren vorbehalten.");
  }

  const { id } = await context.params;
  const url = new URL(request.url);
  const purge = url.searchParams.get("purge") === "true";

  const existing = await prisma.zaehler.findUnique({
    where: { id },
    select: { ...SELECT, _count: { select: { ablesungen: true } } },
  });
  if (!existing) return notFoundProblem(`Kein Zähler mit der Id ${id}.`);

  const readingCount = existing._count.ablesungen;

  if (!purge) {
    // Der sichere Weg, und deshalb der Standard: stilllegen. Der Zähler
    // verschwindet aus Listen und Rechnungen, seine Historie bleibt.
    if (readingCount > 0) {
      const deactivated = await prisma.zaehler.update({
        where: { id },
        data: { aktiv: false },
        select: SELECT,
      });
      void recordAuditEvent(
        AUDIT_ACTIONS.apiMeterUpdate,
        `${gate.user!.email} (${gate.user!.via})`,
        `Zähler ${id} (${existing.name}) stillgelegt — ${readingCount} Ablesungen bleiben erhalten`,
      ).catch(() => {});

      return NextResponse.json({
        ok: true,
        deactivated: true,
        meter: serialize(deactivated),
        // Der Aufrufer soll nicht raten müssen, warum nichts gelöscht wurde.
        hint:
          `Der Zähler wurde stillgelegt, nicht gelöscht — an ihm hängen ${readingCount} ` +
          "Ablesungen. Zum endgültigen Löschen `?purge=true` anhängen.",
      });
    }
    // Ohne Ablesungen gibt es nichts zu verlieren: ein leerer Zähler, meist ein
    // Versehen beim Anlegen. Den stillzulegen statt zu entfernen hinterließe
    // eine Karteileiche, die niemand je wieder anfasst.
  }

  await prisma.zaehler.delete({ where: { id } });

  void recordAuditEvent(
    AUDIT_ACTIONS.apiMeterDelete,
    `${gate.user!.email} (${gate.user!.via})`,
    `Zähler ${id} (${existing.name}) endgültig gelöscht — mit ${readingCount} Ablesungen`,
  ).catch(() => {});

  return NextResponse.json({ ok: true, deleted: serialize(existing), readingsDeleted: readingCount });
}
