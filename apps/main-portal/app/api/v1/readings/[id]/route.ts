import { type NextRequest, NextResponse } from "next/server";
import {
  apiReadingPatchSchema,
  calculateConsumption,
  DEFAULT_OBIS_CODE,
  prisma,
} from "@zaehlwerk/database";
import { authenticateApiRequest, unauthorizedResponse } from "../../../../lib/api-auth";
import { clientIdentifier, rateLimit } from "../../../../lib/rate-limit";
import { AUDIT_ACTIONS, recordAuditEvent } from "../../../../lib/audit";
import {
  fieldErrorsFromZod,
  notFoundProblem,
  rateLimitedProblem,
  unprocessableProblem,
  validationProblem,
} from "../../../../lib/api-problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Eine EINZELNE Ablesung lesen, korrigieren, löschen.
//
// Die API konnte bislang nur anlegen. Für eine Automation, die nur meldet,
// reicht das; für eine, die auch aufräumen soll, nicht — ein doppelt gesendeter
// Stand oder ein Tippfehler war über die API nicht mehr einzufangen, obwohl
// beides genau dort entsteht, wo kein Mensch hinschaut.

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

/** Synthetische Id für den geänderten Stand während der Plausibilitätsprüfung. */
const PENDING_ID = "__pending__";

function serialize(reading: {
  id: string;
  zaehlerId: string;
  registerId: string | null;
  datum: Date;
  wert: number;
  kosten: number | null;
  notiz: string | null;
  quelle: string;
  zaehlerGetauscht: boolean;
  startwertNeu: number | null;
}) {
  return {
    id: reading.id,
    meterId: reading.zaehlerId,
    registerId: reading.registerId,
    value: reading.wert,
    timestamp: reading.datum.toISOString(),
    cost: reading.kosten,
    note: reading.notiz,
    source: reading.quelle,
    meterSwapped: reading.zaehlerGetauscht,
    newMeterStart: reading.startwertNeu,
  };
}

const SELECT = {
  id: true,
  zaehlerId: true,
  registerId: true,
  datum: true,
  wert: true,
  kosten: true,
  notiz: true,
  quelle: true,
  zaehlerGetauscht: true,
  startwertNeu: true,
} as const;

/** Bremse und Ausweis — für jede Methode dieselbe Reihenfolge. */
async function guard(request: NextRequest, scope: string) {
  const limit = rateLimit({
    key: `${scope}:${clientIdentifier(request)}`,
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (!limit.ok) return { response: rateLimitedProblem(limit.retryAfter) };

  const user = await authenticateApiRequest(request);
  if (!user) return { response: unauthorizedResponse() };
  return { user };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await guard(request, "reading-read");
  if (gate.response) return gate.response;

  const { id } = await context.params;
  const reading = await prisma.ablesung.findUnique({ where: { id }, select: SELECT });
  if (!reading) return notFoundProblem(`Keine Ablesung mit der Id ${id}.`);

  return NextResponse.json({ reading: serialize(reading) });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await guard(request, "reading-write");
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

  const parsed = apiReadingPatchSchema.safeParse(body);
  if (!parsed.success) return validationProblem(fieldErrorsFromZod(parsed.error));

  const existing = await prisma.ablesung.findUnique({ where: { id }, select: SELECT });
  if (!existing) return notFoundProblem(`Keine Ablesung mit der Id ${id}.`);

  const { allowImplausible, ...patch } = parsed.data;
  const next = {
    wert: patch.value ?? existing.wert,
    datum: patch.timestamp ?? existing.datum,
    zaehlerGetauscht: patch.zaehlerGetauscht ?? existing.zaehlerGetauscht,
    startwertNeu:
      patch.startwertNeu === undefined ? existing.startwertNeu : (patch.startwertNeu ?? null),
  };

  // Ein Startwert ohne Zählertausch ist widersprüchlich — dieselbe Regel wie
  // beim Anlegen, hier aber gegen den ZUSAMMENGEFÜHRTEN Stand geprüft: Wer per
  // PATCH nur `zaehlerGetauscht: false` sendet, würde sonst einen Startwert
  // stehen lassen, der zu nichts mehr gehört.
  if (next.startwertNeu !== null && !next.zaehlerGetauscht) {
    return validationProblem(
      [{ field: "startwertNeu", message: "Ein Startwert ist nur bei einem Zählertausch zulässig." }],
      "Ein Startwert ist nur bei einem Zählertausch zulässig.",
    );
  }
  if (next.startwertNeu !== null && next.startwertNeu > next.wert) {
    return validationProblem(
      [
        {
          field: "startwertNeu",
          message: "Der Startwert des neuen Zählers darf nicht über dem Ablesewert liegen.",
        },
      ],
      "Der Startwert des neuen Zählers darf nicht über dem Ablesewert liegen.",
    );
  }

  // Plausibilität über die REIHE, in der diese Ablesung liegt — und ohne sie
  // selbst, denn sie wird ja gerade ersetzt. Sonst prüfte man den neuen Stand
  // gegen den alten desselben Datensatzes.
  const siblings = await prisma.ablesung.findMany({
    where: {
      id: { not: id },
      ...(existing.registerId
        ? { registerId: existing.registerId }
        : // Ohne Registerbezug: die Reihe des Standardregisters, zu der auch
          // alles ohne Zuordnung gehört.
          {
            zaehlerId: existing.zaehlerId,
            OR: [{ registerId: null }, { register: { obisCode: DEFAULT_OBIS_CODE } }],
          }),
    },
    select: { id: true, datum: true, wert: true, zaehlerGetauscht: true, startwertNeu: true },
  });

  const zaehler = await prisma.zaehler.findUnique({
    where: { id: existing.zaehlerId },
    select: { stellen: true },
  });

  const intervals = calculateConsumption(
    [...siblings, { id: PENDING_ID, ...next }],
    { stellen: zaehler?.stellen ?? null },
  );
  const changed = intervals.find((interval) => interval.toReadingId === PENDING_ID) ?? null;

  if (changed !== null && changed.amount === null && !allowImplausible) {
    return unprocessableProblem(
      "Unplausibler Zählerstand: Der Verbrauch seit der vorherigen Ablesung wäre negativ. " +
        "Bei einem Zählertausch `zaehlerGetauscht`/`startwertNeu` senden, oder `allowImplausible: true`.",
      {
        plausibility: {
          from: changed?.from?.toISOString() ?? null,
          to: changed?.to.toISOString() ?? null,
          value: next.wert,
        },
      },
    );
  }

  const updated = await prisma.ablesung.update({
    where: { id },
    data: {
      ...next,
      ...(patch.note === undefined ? {} : { notiz: patch.note ?? null }),
      ...(patch.cost === undefined ? {} : { kosten: patch.cost ?? null }),
    },
    select: SELECT,
  });

  void recordAuditEvent(
    AUDIT_ACTIONS.apiReadingUpdate,
    `${gate.user!.email} (${gate.user!.via})`,
    `Ablesung ${id}: ${existing.wert} → ${updated.wert}`,
  ).catch(() => {});

  return NextResponse.json({ reading: serialize(updated) });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await guard(request, "reading-write");
  if (gate.response) return gate.response;

  const { id } = await context.params;
  const existing = await prisma.ablesung.findUnique({ where: { id }, select: SELECT });
  if (!existing) return notFoundProblem(`Keine Ablesung mit der Id ${id}.`);

  await prisma.ablesung.delete({ where: { id } });

  // Der gelöschte Wert steht IM Eintrag, nicht nur die Id. Nach dem Löschen ist
  // die Zeile fort; eine Protokollzeile, die nur „Ablesung xy gelöscht" sagt,
  // beantwortet die einzige Frage nicht, die später gestellt wird — welche Zahl
  // war das.
  void recordAuditEvent(
    AUDIT_ACTIONS.apiReadingDelete,
    `${gate.user!.email} (${gate.user!.via})`,
    `Ablesung ${id}: ${existing.wert} vom ${existing.datum.toISOString().slice(0, 10)}`,
  ).catch(() => {});

  return NextResponse.json({ ok: true, deleted: serialize(existing) });
}
