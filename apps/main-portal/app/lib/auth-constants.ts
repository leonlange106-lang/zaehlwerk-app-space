// Plain module (NOT "use server") so both a server action and auth.ts can
// import this constant — "use server" files may only export async functions.

/** Short-lived cookie proving the password step passed, bridging /login → /login/2fa. */
export const CHALLENGE_COOKIE = "zw_2fa_challenge";
