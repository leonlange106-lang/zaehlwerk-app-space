// Role constants, split out of `auth.ts` deliberately.
//
// `auth.ts` also holds the Zod validation schemas, and this package compiles to
// CommonJS — where a re-export barrel (`__exportStar(require(...))`) is opaque to
// webpack's tree-shaking. So a client component importing nothing but
// `USER_ROLE_LABELS` used to drag Zod (≈354 KB raw / 67.5 KB gzip) into the
// browser bundle. `PortalShell` does exactly that and sits in the root layout, so
// every single route paid for it.
//
// Keep this file free of imports. It is re-exported by `client.ts`, whose whole
// purpose is to stay zod-free.

export const USER_ROLES = ["ADMIN", "USER"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrator",
  USER: "Benutzer",
};
