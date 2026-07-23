// Validation for MGflasher share links. Kept pure and dependency-free so the
// same rules run on the client (instant field validation) and on the server
// (authoritative check before any outbound fetch — this is also our SSRF guard:
// we ONLY ever fetch the one known host, never arbitrary user-supplied URLs).

/** The only host the remote-import endpoint is ever allowed to contact. */
export const MGFLASHER_HOST = "logs.mgflasher.com";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ShareLinkResult =
  | { ok: true; uuid: string; canonicalUrl: string; csvUrl: string }
  | { ok: false; reason: string };

/**
 * Validate a user-supplied MGflasher share link and derive the canonical log
 * URL plus the CSV-export URL to fetch. Pattern: `https://logs.mgflasher.com/log/<UUID>`.
 *
 * The CSV endpoint base is overridable via `MGFLASHER_LOG_BASE` (tests / self-host
 * proxies); it defaults to the public host. Only https + the allowed host pass.
 */
export function parseShareLink(input: string, baseOverride?: string): ShareLinkResult {
  const raw = input.trim();
  if (raw === "") return { ok: false, reason: "Bitte einen Share-Link eingeben." };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Keine gültige URL." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "Nur https-Links werden akzeptiert." };
  }
  if (url.hostname.toLowerCase() !== MGFLASHER_HOST) {
    return { ok: false, reason: `Nur Links von ${MGFLASHER_HOST} werden akzeptiert.` };
  }

  const match = url.pathname.match(/^\/log\/([^/]+)\/?$/);
  if (!match) {
    return { ok: false, reason: "Unerwartetes Link-Format (erwartet /log/<id>)." };
  }
  const uuid = match[1];
  if (!UUID_RE.test(uuid)) {
    return { ok: false, reason: "Die Log-ID im Link ist ungültig." };
  }

  const base = (baseOverride ?? `https://${MGFLASHER_HOST}`).replace(/\/+$/, "");
  return {
    ok: true,
    uuid,
    canonicalUrl: `https://${MGFLASHER_HOST}/log/${uuid}`,
    csvUrl: `${base}/log/${uuid}/export.csv`,
  };
}
