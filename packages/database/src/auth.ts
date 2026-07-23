// Browser-safe auth primitives (no Prisma import), so client components can use
// the role type/labels + validation schemas without pulling in the server-only
// Prisma client. Role string values mirror the Prisma `Role` enum.

import { z } from "zod";

export const USER_ROLES = ["ADMIN", "USER"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrator",
  USER: "Benutzer",
};

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
