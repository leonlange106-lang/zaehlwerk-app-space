import { NextResponse } from "next/server";
import { prisma } from "@zaehlwerk/database";
import { getSessionUser } from "@/app/lib/auth-helpers";
import { allowedAppIdsFor } from "@/app/lib/app-access";
import { STATIC_SEARCH_TARGETS } from "@/app/lib/search-targets";
import {
  caseVariants,
  isSearchable,
  matchStaticTargets,
  normalizeQuery,
  rankHits,
  scoreMatch,
  type SearchHit,
} from "@/app/lib/search-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One endpoint behind the header search field.
//
// **App freigaben are enforced here, not in the UI.** A hit from an app the
// account has no access to would name data it is not allowed to know exists —
// the same lesson as the Server Actions in AUDIT.md § 4.1, and the reason the
// meter and log queries below run only when their app is in `allowed`. The
// static targets get the same treatment inside `matchStaticTargets`.
//
// No FTS5, deliberately. `contains` over a few indexed columns is enough for a
// corpus this size, and a virtual table would be a schema change plus a
// rebuild-on-write for a search over hundreds of rows.

/** Per source, so one chatty source cannot crowd the others out of the popover. */
const PER_SOURCE_LIMIT = 5;

/** OR-ed LIKE clauses over the case variants — see caseVariants(). */
function containsAny(field: string, variants: string[]) {
  return variants.map((value) => ({ [field]: { contains: value } }));
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  // proxy.ts already turns anonymous /api/* away with a 401; this is the second
  // gate, because the route must not depend on the guard staying configured.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = new URL(request.url).searchParams.get("q") ?? "";
  const query = normalizeQuery(raw);
  if (!isSearchable(query)) {
    return NextResponse.json({ hits: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const isAdmin = user.role === "ADMIN";
  const allowed = await allowedAppIdsFor(user);
  const variants = caseVariants(query);

  const [meters, logs] = await Promise.all([
    allowed.includes("zaehlwerk") ? findMeters(variants) : Promise.resolve([]),
    allowed.includes("log-analyzer") ? findLogs(variants) : Promise.resolve([]),
  ]);

  const hits = rankHits([
    ...matchStaticTargets(STATIC_SEARCH_TARGETS, query, { allowedAppIds: allowed, isAdmin }),
    ...scoreRows(meters, query),
    ...scoreRows(logs, query),
  ]);

  return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * A row plus every string the SQL matched on.
 *
 * `terms` exists because the two halves must agree: the query can match a log's
 * `tags` column, but the scorer below only reads the title and subtitle, and a
 * row scoring zero is dropped. Without carrying the matched columns through, a
 * tag-only hit is fetched from the database and then silently discarded — the
 * search would simply not find things it demonstrably matched.
 */
type ScorableRow = Omit<SearchHit, "score"> & { terms?: string[] };

/** Re-rank DB rows with the same scorer the static targets use, then cap. */
function scoreRows(rows: ScorableRow[], query: string): SearchHit[] {
  return rankHits(
    rows.map(({ terms, ...row }) => {
      let score = Math.max(
        scoreMatch(row.title, query),
        scoreMatch(row.subtitle ?? "", query) * 0.5,
      );
      // Secondary columns rank below the name, but they must still rank.
      for (const term of terms ?? []) {
        score = Math.max(score, scoreMatch(term, query) * 0.5);
      }
      return { ...row, score };
    }),
  )
    .filter((hit) => hit.score > 0)
    .slice(0, PER_SOURCE_LIMIT);
}

async function findMeters(variants: string[]): Promise<ScorableRow[]> {
  const rows = await prisma.zaehler.findMany({
    where: {
      OR: [
        ...containsAny("name", variants),
        { location: { OR: containsAny("name", variants) } },
      ],
    },
    // Over-fetch a little: the SQL match is looser than scoreRows(), which drops
    // anything the scorer rates at zero, so a hard LIMIT of 5 here could return
    // five rows and show none.
    take: PER_SOURCE_LIMIT * 4,
    orderBy: [{ aktiv: "desc" }, { sortIndex: "asc" }],
    select: {
      id: true,
      name: true,
      einheit: true,
      farbe: true,
      aktiv: true,
      location: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    kind: "meter" as const,
    id: row.id,
    title: row.name,
    subtitle: [row.location?.name, row.einheit, row.aktiv ? null : "inaktiv"]
      .filter(Boolean)
      .join(" · "),
    href: `/apps/zaehlwerk/zaehler/${row.id}`,
    dot: row.farbe,
  }));
}

const logDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const HEALTH_DOT: Record<string, string> = {
  safe: "var(--zw-ok)",
  caution: "var(--zw-watch)",
  danger: "var(--zw-risk)",
};

async function findLogs(variants: string[]): Promise<Omit<SearchHit, "score">[]> {
  const rows = await prisma.logFile.findMany({
    where: {
      OR: [
        ...containsAny("label", variants),
        ...containsAny("name", variants),
        ...containsAny("tags", variants),
        ...containsAny("vehicle", variants),
      ],
    },
    take: PER_SOURCE_LIMIT * 4,
    orderBy: [{ recordedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    // NEVER select `csv` — it is by far the largest column in the database and a
    // search that dragged it along would read megabytes to render five lines.
    select: {
      id: true,
      name: true,
      label: true,
      tags: true,
      health: true,
      vehicle: true,
      recordedAt: true,
    },
  });

  return rows.map((row) => ({
    kind: "log" as const,
    id: row.id,
    // A named log is shown by its name; an unnamed one has only its filename.
    title: row.label ?? row.name,
    subtitle: [
      row.label ? row.name : null,
      row.vehicle,
      row.recordedAt ? logDateFormatter.format(row.recordedAt) : null,
    ]
      .filter(Boolean)
      .join(" · "),
    href: `/apps/log-analyzer?log=${encodeURIComponent(row.id)}`,
    dot: HEALTH_DOT[row.health] ?? "var(--zw-neutral)",
    // `tags` is the one column the WHERE above matches that appears in neither
    // the title nor the subtitle — `label` and `name` are the title (or the
    // subtitle when a label replaced the filename), `vehicle` is the subtitle.
    // Without carrying it, a log found by one of its tags scores zero and is
    // dropped after being fetched: matched by the database, discarded by us.
    terms: row.tags ? [row.tags] : [],
  }));
}
