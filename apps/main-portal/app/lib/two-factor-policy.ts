import { prisma } from "@zaehlwerk/database";
import { getEnforceTwoFactor } from "./settings";

// Instance-wide "every account needs a second factor".
//
// WHERE THIS IS ENFORCED, and why not in `proxy.ts`.
//
// `proxy.ts` is the global auth guard and would be the natural home — it is the
// one chokepoint every request passes. It runs on the EDGE runtime, though,
// which has no database (that is the whole reason auth.config.ts exists apart
// from auth.ts). It can therefore only read what the JWT already carries, and a
// JWT is a snapshot taken at sign-in: an admin turning enforcement ON would not
// reach any session issued before that moment, for up to the token's refresh
// interval. A security control that takes effect "within a day, probably" is not
// a security control.
//
// So the gate lives where the database does:
//
//   Pages — the root layout resolves this and renders the enrolment screen
//           INSTEAD of the page. Not a redirect: a redirect needs the pathname
//           (which a layout does not get) and an exemption for the target route,
//           which is one more thing to get wrong. Not rendering `children` at
//           all means the page's markup is never produced or sent.
//   APIs  — folded into `denyUnlessAdmin` / `denyUnlessAppAccess`, the existing
//           authorization chokepoints, which already run in Node with a DB.
//
// Both read the current value per request, so flipping the switch takes effect
// on the next navigation rather than the next login.

export interface TwoFactorGateInput {
  /** Instance setting: is a second factor mandatory here? */
  enforced: boolean;
  /** Does THIS account have 2FA active? */
  userHasTwoFactor: boolean;
  /** Is the account still on a temporary password? */
  mustSetPassword: boolean;
}

/**
 * Should this request be blocked until the user enrols?
 *
 * Pure, so the precedence rule is testable without a session or a database.
 *
 * `mustSetPassword` wins deliberately: that gate already owns the session and
 * redirects to /set-password. Letting the 2FA gate render on top of it would
 * replace the password page with an enrolment screen the user cannot leave —
 * they would be asked for a second factor before they even have a first one.
 */
export function twoFactorGateBlocks(input: TwoFactorGateInput): boolean {
  if (!input.enforced) return false;
  if (input.mustSetPassword) return false;
  return !input.userHasTwoFactor;
}

export interface TwoFactorGateState {
  /** True when the app must be replaced by the enrolment screen. */
  blocked: boolean;
  /** True when the instance requires 2FA at all — drives the settings UI copy. */
  enforced: boolean;
}

/**
 * Resolve the gate for a signed-in user. Reads the instance setting and the
 * user's own 2FA state, both live.
 */
export async function resolveTwoFactorGate(user: {
  id: string;
  mustSetPassword?: boolean;
} | null): Promise<TwoFactorGateState> {
  if (!user) return { blocked: false, enforced: false };

  const [enforced, record] = await Promise.all([
    getEnforceTwoFactor(),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true, mustSetPassword: true },
    }),
  ]);

  // An unknown id means the account was deleted mid-session. Nothing to enrol,
  // and the session is about to fail anyway — do not block on it.
  if (!record) return { blocked: false, enforced };

  return {
    blocked: twoFactorGateBlocks({
      enforced,
      userHasTwoFactor: record.twoFactorEnabled,
      mustSetPassword: record.mustSetPassword,
    }),
    enforced,
  };
}
