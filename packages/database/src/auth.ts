// Browser-safe auth primitives (no Prisma import), so client components can use
// the role type/labels + validation schemas without pulling in the server-only
// Prisma client. Role string values mirror the Prisma `Role` enum.
//
// The role constants themselves now live in `roles.ts` and are re-exported here
// for compatibility: they are zod-free, and keeping them in this module meant a
// client importing only `USER_ROLE_LABELS` also got the Zod runtime. Client
// components should import from `@zaehlwerk/database/client` instead.

import { z } from "zod";

export { USER_ROLES, USER_ROLE_LABELS, type UserRole } from "./roles";

const emailSchema = z.string().trim().min(1, "E-Mail ist erforderlich.").email("Bitte eine gültige E-Mail angeben.");
const passwordSchema = z.string().min(8, "Das Passwort muss mindestens 8 Zeichen haben.");
const nameSchema = z
  .string()
  .trim()
  .max(120, "Name ist zu lang.")
  .optional()
  .or(z.literal("").transform(() => undefined));

/** First-boot admin account (Zero-Config First Boot). */
export const setupAdminSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  password: passwordSchema,
});

/**
 * Creating a user via the admin user management. No password here: new accounts
 * are created with a temp password and the user sets their own on first login
 * (see `mustSetPassword`).
 */
export const userCreateSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  role: z.enum(["ADMIN", "USER"]),
});

/** Resetting a user's password. */
export const passwordResetSchema = z.object({
  userId: z.string().min(1),
  password: passwordSchema,
});

/** Changing a user's role. */
export const roleChangeSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["ADMIN", "USER"]),
});

export type SetupAdminInput = z.infer<typeof setupAdminSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
