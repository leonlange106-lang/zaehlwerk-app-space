import { NextResponse } from "next/server";

/**
 * Ein einheitliches Fehlerformat für `/api/v1`, nach RFC 9457 (Problem Details).
 *
 * Vorher hatte fast jede Route ihre eigene Form: mal `{ error }`, mal
 * `{ success: false, error }`, mal `{ error, knownObisCodes }`. Wer eine
 * Integration schreibt, muss dann für jeden Endpunkt neu herausfinden, wo die
 * Begründung steht — und schreibt am Ende `err.error ?? err.message ?? "?"`.
 *
 * RFC 9457 statt einer eigenen Erfindung, weil es das ist, wonach ein Client
 * ohnehin sucht, und weil es Erweiterungsfelder ausdrücklich vorsieht: Die
 * `knownObisCodes`, die eine Fehlermeldung erst nützlich machen, stehen
 * regelkonform neben `detail` statt darin.
 *
 * ## Verträglichkeit
 *
 * `error` bleibt drin, mit demselben Text wie `detail`.
 *
 * Das ist kein Zögern, sondern der Punkt: Draußen laufen Automationen, die
 * genau dieses Feld lesen. Sie umzustellen ist Arbeit für ihre Besitzer, und
 * ein Feld wegzunehmen, dessen Verschwinden erst beim nächsten Fehler auffällt,
 * ist die unfreundlichste Art, eine API zu verbessern — der Bruch zeigt sich
 * dann, wenn ohnehin schon etwas schiefgeht.
 */

/** Die Fehlerarten, die diese API kennt. Geschlossene Liste, damit `type` etwas bedeutet. */
export const PROBLEM_TYPES = {
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  notFound: "not-found",
  validation: "validation-error",
  rateLimited: "rate-limited",
  conflict: "conflict",
  unprocessable: "unprocessable",
  payloadTooLarge: "payload-too-large",
  internal: "internal-error",
} as const;

export type ProblemType = (typeof PROBLEM_TYPES)[keyof typeof PROBLEM_TYPES];

/**
 * Basis der `type`-URIs.
 *
 * Bewusst eine dokumentationsartige URL und keine echte Route: RFC 9457
 * verlangt einen URI als *Kennung*, nicht als abrufbare Seite. Eine erfundene
 * `/api/v1/errors/...`-Route zu bauen, die niemand aufruft, wäre Ballast; ein
 * Pfad in der Doku ist die ehrlichere Kennung.
 */
const TYPE_BASE = "https://github.com/leonlange106-lang/zaehlwerk-app-space/blob/main/docs/api/errors.md";

const TITLES: Record<ProblemType, string> = {
  "unauthorized": "Nicht authentifiziert",
  "forbidden": "Kein Zugriff",
  "not-found": "Nicht gefunden",
  "validation-error": "Ungültige Eingabe",
  "rate-limited": "Zu viele Anfragen",
  "conflict": "Konflikt",
  "unprocessable": "Nicht verarbeitbar",
  "payload-too-large": "Anfrage zu groß",
  "internal-error": "Interner Fehler",
};

export interface ProblemOptions {
  /** Was genau schiefging — der Satz, den ein Mensch liest. */
  detail: string;
  /** HTTP-Status. */
  status: number;
  /**
   * Zusätzliche Felder, z. B. `knownObisCodes` oder `errors`.
   *
   * RFC 9457 erlaubt sie ausdrücklich auf oberster Ebene. Sie gehören dorthin
   * und nicht in `detail`: Ein Client soll sie auswerten können, ohne einen
   * deutschen Satz zu zerlegen.
   */
  extensions?: Record<string, unknown>;
  /** Zusätzliche Kopfzeilen, z. B. `Retry-After`. */
  headers?: Record<string, string>;
}

/** Antwort im Problem-Format. Setzt `Content-Type: application/problem+json`. */
export function problemResponse(type: ProblemType, options: ProblemOptions): NextResponse {
  const body = {
    type: `${TYPE_BASE}#${type}`,
    title: TITLES[type],
    status: options.status,
    detail: options.detail,
    // Siehe Kommentar oben: bleibt für bestehende Automationen.
    error: options.detail,
    ...options.extensions,
  };

  return NextResponse.json(body, {
    status: options.status,
    headers: {
      "Content-Type": "application/problem+json; charset=utf-8",
      ...options.headers,
    },
  });
}

// --- Die Fälle, die in mehr als einer Route vorkommen -----------------------

export function unauthorizedProblem(): NextResponse {
  return problemResponse(PROBLEM_TYPES.unauthorized, {
    status: 401,
    detail:
      "Kein gültiger Zugang. Melde dich an oder sende ein Personal Access Token " +
      "als `Authorization: Bearer zw_pat_…`.",
  });
}

export function forbiddenProblem(detail = "Für diese Aktion fehlen dir die Rechte."): NextResponse {
  return problemResponse(PROBLEM_TYPES.forbidden, { status: 403, detail });
}

export function notFoundProblem(detail: string): NextResponse {
  return problemResponse(PROBLEM_TYPES.notFound, { status: 404, detail });
}

/**
 * Zu viele Anfragen.
 *
 * `Retry-After` gehört dazu, sonst rät der Aufrufer — und ein Gerät, das rät,
 * probiert es in einer Sekunde wieder und verlängert die Sperre.
 */
export function rateLimitedProblem(retryAfterSeconds: number, detail?: string): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return problemResponse(PROBLEM_TYPES.rateLimited, {
    status: 429,
    detail: detail ?? `Zu viele Anfragen. Bitte in ${seconds} Sekunden erneut versuchen.`,
    extensions: { retryAfter: seconds },
    headers: { "Retry-After": String(seconds) },
  });
}

/** Ein einzelner Eingabefehler — Feldpfad und Begründung. */
export interface FieldError {
  field: string;
  message: string;
}

/**
 * Ungültige Eingabe.
 *
 * ALLE Fehler, nicht nur der erste: Wer drei Felder falsch gefüllt hat, soll
 * das in einer Runde erfahren und nicht in dreien.
 */
export function validationProblem(
  errors: FieldError[],
  detail?: string,
  extensions?: Record<string, unknown>,
): NextResponse {
  const first = errors[0];
  return problemResponse(PROBLEM_TYPES.validation, {
    status: 400,
    detail: detail ?? first?.message ?? "Die Anfrage konnte nicht gelesen werden.",
    extensions: { errors, ...extensions },
  });
}

/** Zod-Fehler in die Feldliste übersetzen. */
export function fieldErrorsFromZod(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

/** Semantisch abgelehnt, obwohl formal gültig — z. B. ein unplausibler Zählerstand. */
export function unprocessableProblem(
  detail: string,
  extensions?: Record<string, unknown>,
): NextResponse {
  return problemResponse(PROBLEM_TYPES.unprocessable, { status: 422, detail, extensions });
}

/**
 * Interner Fehler.
 *
 * `detail` bleibt bewusst allgemein: Eine Ausnahme nach außen zu reichen,
 * verrät Pfade und Bibliotheksversionen. Die Einzelheiten gehören ins
 * Server-Log, wo sie der Betreiber sieht und der Aufrufer nicht.
 */
export function internalProblem(
  detail = "Unerwarteter Fehler. Einzelheiten stehen im Server-Log.",
): NextResponse {
  return problemResponse(PROBLEM_TYPES.internal, { status: 500, detail });
}
