import { signOut } from "next-auth/react";

/**
 * Sign out and land on /login — without letting Auth.js build the URL.
 *
 * `signOut({ callbackUrl: "/login" })` makes the SERVER resolve that relative
 * path against its own idea of the base URL, and that idea was wrong: the
 * container sets `HOSTNAME=0.0.0.0` (the bind address Next's standalone server
 * needs), which is how signing out landed people on `http://0.0.0.0:3000/login`
 * — an address no browser can reach.
 *
 * Setting `AUTH_URL` would fix it by hardcoding one origin, and that is the
 * wrong trade for this app: it is reached over the LAN, through a tunnel, and
 * via Home Assistant Ingress, and only one of those could be the configured
 * one. So we never ask the server. `redirect: false` returns instead of
 * redirecting, and the browser resolves a relative path against the origin it
 * is already on — which is correct by construction, whichever that is.
 *
 * A full navigation rather than router.push: signing out must drop the client
 * router cache and re-run the server layout, not soft-navigate with the old
 * session still in memory.
 */
export async function signOutToLogin(): Promise<void> {
  await signOut({ redirect: false });
  window.location.href = "/login";
}
