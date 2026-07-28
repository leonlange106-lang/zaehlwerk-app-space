// Matching and ranking for the global search. Pure and framework-free — no
// Prisma, no React — so it is the unit-test surface for the part that actually
// decides what a person sees.

/** Where a hit came from. Drives the icon and the grouping in the popover. */
export type SearchKind = "meter" | "log" | "settings" | "admin" | "page";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Second line: location, date, group description — whatever locates the hit. */
  subtitle?: string;
  href: string;
  /** Meter colour / log health, shown as a dot. Never the only signal. */
  dot?: string;
  score: number;
}

/** Something matchable that is known at build time: a page or a settings group. */
export interface StaticTarget {
  kind: Extract<SearchKind, "settings" | "admin" | "page">;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  /** Extra words that should find this target without appearing in its title. */
  topics?: string[];
  /** Only offered when the user may use this app. `null` = platform-wide. */
  appId?: string | null;
  adminOnly?: boolean;
}

/** Longer than this and it is a paste, not a search. */
export const MAX_QUERY_LENGTH = 64;
/** Below this every query matches half the corpus, so we do not run one. */
export const MIN_QUERY_LENGTH = 2;

export function normalizeQuery(raw: string): string {
  return raw.trim().slice(0, MAX_QUERY_LENGTH);
}

export function isSearchable(raw: string): boolean {
  return normalizeQuery(raw).length >= MIN_QUERY_LENGTH;
}

/**
 * Case variants to hand to SQLite's LIKE.
 *
 * `contains` compiles to `LIKE '%term%'`, and SQLite's LIKE folds case for
 * **ASCII only** — Prisma's `mode: "insensitive"` does not exist on this
 * provider. So "zahler" finds "Zähler" while "zähler" does not, which in a
 * German UI is the common case failing rather than an edge one. Passing a few
 * explicit variants and OR-ing them costs one cheap index-free scan over a table
 * measured in hundreds of rows, and it makes umlauts behave.
 *
 * An all-ASCII term returns exactly ONE clause — LIKE already handles it, and
 * three redundant OR-branches per query would be pure waste.
 */
export function caseVariants(term: string): string[] {
  if (/^[\x00-\x7F]*$/.test(term)) return term ? [term] : [];
  const lower = term.toLocaleLowerCase("de-DE");
  const upper = term.toLocaleUpperCase("de-DE");
  const capitalized = lower.charAt(0).toLocaleUpperCase("de-DE") + lower.slice(1);
  return [...new Set([term, lower, upper, capitalized])].filter(Boolean);
}

/** Fold for in-memory comparison: case and umlauts both flattened. */
export function foldForCompare(value: string): string {
  return value
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/**
 * How well does `haystack` answer `needle`? 0 means no match.
 *
 * The ordering it produces matters more than the numbers: an exact title beats a
 * title that starts with the term, which beats a term found anywhere in it,
 * which beats a match that only came from the topic list. Without that last
 * step, typing "Backup" ranks every group carrying the word in its topics above
 * the group actually called that.
 */
export function scoreMatch(haystack: string, needle: string): number {
  if (!haystack || !needle) return 0;
  const hay = foldForCompare(haystack);
  const term = foldForCompare(needle);
  if (!term) return 0;
  if (hay === term) return 100;
  if (hay.startsWith(term)) return 75;
  // Word-start anywhere: "prüf" should find "Virtueller Prüfstand".
  if (new RegExp(`(^|[\\s\\-_/.])${escapeRegExp(term)}`).test(hay)) return 60;
  if (hay.includes(term)) return 40;
  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match the static targets — pages and settings groups.
 *
 * `allowedAppIds` and `isAdmin` are applied HERE rather than by the caller, so
 * there is no path that produces hits and forgets to filter them. A result from
 * an app the user has no access to is an information leak by another name: it
 * names data that account is not allowed to know exists.
 */
export function matchStaticTargets(
  targets: StaticTarget[],
  query: string,
  { allowedAppIds, isAdmin }: { allowedAppIds: string[]; isAdmin: boolean },
): SearchHit[] {
  const term = normalizeQuery(query);
  if (!isSearchable(term)) return [];

  const hits: SearchHit[] = [];
  for (const target of targets) {
    if (target.adminOnly && !isAdmin) continue;
    if (target.appId && !allowedAppIds.includes(target.appId)) continue;

    let score = Math.max(scoreMatch(target.title, term), scoreMatch(target.subtitle ?? "", term) * 0.4);
    // Topics are the fallback channel, capped below any title match so a real
    // title hit always sorts first.
    if (score === 0) {
      for (const topic of target.topics ?? []) {
        const topicScore = scoreMatch(topic, term);
        if (topicScore > score) score = topicScore * 0.35;
      }
    }
    if (score > 0) {
      hits.push({
        kind: target.kind,
        id: target.id,
        title: target.title,
        subtitle: target.subtitle,
        href: target.href,
        score,
      });
    }
  }
  return rankHits(hits);
}

/** Highest score first; ties broken by title so the order is never arbitrary. */
export function rankHits(hits: SearchHit[]): SearchHit[] {
  return [...hits].sort(
    (a, b) => b.score - a.score || a.title.localeCompare(b.title, "de-DE"),
  );
}
