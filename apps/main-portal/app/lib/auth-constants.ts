// Plain module (NOT "use server") so both a server action and auth.ts can
// import from it — "use server" files may only export async functions.

/** Short-lived cookie proving the password step passed, bridging /login → /login/2fa. */
export const CHALLENGE_COOKIE = "zw_2fa_challenge";

/** How long the password step stays good for, in seconds. */
export const CHALLENGE_TTL_SECONDS = 300;

type HeaderLike = { get(name: string): string | null | undefined };

/**
 * Only the two variables that may legitimately override protocol detection.
 * Narrower than ProcessEnv on purpose: NODE_ENV is not reachable from in here,
 * so the mistake this function exists to correct cannot be made again inside it.
 */
type UrlEnv = { AUTH_URL?: string; NEXTAUTH_URL?: string };

/**
 * Should a cookie we set ourselves carry the `secure` flag?
 *
 * Derived from the REQUEST PROTOCOL, never from NODE_ENV — and that distinction
 * is the whole reason this function exists. `secure` on a cookie sent over plain
 * HTTP means the browser discards it without a word: no error, no console
 * warning, the response just has no effect. A hardcoded
 * `secure: NODE_ENV === "production"` therefore breaks every production instance
 * that is not served over TLS, and `docker-compose.prod.yml` publishes port 3000
 * directly while DEPLOYMENT.md calls the TLS-terminating proxy "recommended" —
 * so `http://<lxc-ip>:3000` is an ordinary way to run this, not a mistake.
 *
 * What it broke: the 2FA challenge cookie vanished, /login/2fa had no user to
 * verify the code against, and the only thing left to report was that the code
 * was invalid. Enrolment used no cookie and kept working, so the key looked
 * good, the code looked good, and signing in was impossible.
 *
 * This mirrors Auth.js exactly (`config.useSecureCookies ?? url.protocol ===
 * "https:"`, see @auth/core lib/init.js) — deliberately, because the session
 * cookie and this one must agree about the connection. Precedence follows
 * createActionURL: an explicit AUTH_URL wins, then `x-forwarded-proto` from a
 * terminating proxy, then the request's own protocol.
 *
 * (Not named `useSecureCookies` after Auth.js's option, tempting as that was:
 * the `use` prefix makes the React hooks lint rule treat every call site as a
 * misplaced hook.)
 */
export function isSecureConnection(
  headers: HeaderLike,
  // Spelled out rather than defaulting to process.env, so the two variables this
  // may consult are visible in the signature — and NODE_ENV is not one of them.
  env: UrlEnv = { AUTH_URL: process.env.AUTH_URL, NEXTAUTH_URL: process.env.NEXTAUTH_URL },
): boolean {
  const envUrl = env.AUTH_URL ?? env.NEXTAUTH_URL;
  if (envUrl) {
    try {
      return new URL(envUrl).protocol === "https:";
    } catch {
      // Malformed AUTH_URL — fall through to header detection rather than
      // guessing, so a typo cannot lock everyone out of the second factor.
    }
  }

  // A proxy may pass a list ("https, http") when several hops added their own;
  // the first entry is the one the browser actually spoke.
  const forwarded = headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0].trim().replace(/:$/, "").toLowerCase() === "https";
  }

  // No proxy in front: the origin the browser was given is the one we serve.
  const origin = headers.get("origin") ?? headers.get("referer");
  if (origin) {
    try {
      return new URL(origin).protocol === "https:";
    } catch {
      /* not a URL — fall through */
    }
  }

  // Nothing said otherwise. Plain HTTP is the only case where `secure` actively
  // breaks the flow, and an unproxied HTTPS origin still sends `origin` on the
  // server-action POST that sets this cookie — so the safe default here is the
  // one that keeps working.
  return false;
}
