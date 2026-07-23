"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import {
  passwordResetSchema,
  prisma,
  roleChangeSchema,
  setupAdminSchema,
  userCreateSchema,
} from "@zaehlwerk/database";
import type { UserRole } from "@zaehlwerk/database/shared";
import type { ActionState } from "./action-state";
import { adminCount, requireAdmin, userCount } from "./auth-helpers";
import { AUDIT_ACTIONS, recordAuditEvent } from "./audit";
import { ALL_APP_IDS, parseAllowedApps, serializeAllowedApps } from "./app-access";

const BCRYPT_ROUNDS = 12;

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: Date;
  allowedApps: string[];
};

export async function listUsers(): Promise<AppUser[]> {
  await requireAdmin();
  const rows = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true, allowedApps: true },
  });
  return rows.map((row) => ({ ...row, allowedApps: parseAllowedApps(row.allowedApps) }));
}

/**
 * Set which apps a user may see/use. Admin-only. Unknown ids are dropped.
 * Note: ADMINs always see every app regardless of this value — the assignment
 * still persists, but it only takes effect if their role is later downgraded.
 */
export async function setUserAppsAction(userId: string, appIds: string[]): Promise<ActionState> {
  const admin = await requireAdmin();

  if (!Array.isArray(appIds) || appIds.some((id) => typeof id !== "string")) {
    return { success: false, error: "Ungültige App-Auswahl." };
  }
  const unknown = appIds.filter((id) => !ALL_APP_IDS.includes(id as (typeof ALL_APP_IDS)[number]));
  if (unknown.length > 0) {
    return { success: false, error: "Unbekannte App in der Auswahl." };
  }

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!target) {
    return { success: false, error: "Benutzer nicht gefunden." };
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { allowedApps: serializeAllowedApps(appIds) },
    });
  } catch (error) {
    console.error("[setUserAppsAction]", error);
    return { success: false, error: "Die App-Freigaben konnten nicht gespeichert werden." };
  }

  await recordAuditEvent(
    AUDIT_ACTIONS.userApps,
    admin.email,
    `${target.email} → [${appIds.join(", ") || "keine"}]`,
  );
  // The target's own layout/launcher reads this on next request.
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { success: true };
}

/**
 * First-boot only (Zero-Config First Boot): create the initial ADMIN. PUBLIC by
 * necessity — it must work before anyone can log in — so it hard-guards on there
 * being NO users yet. Once an admin exists this always refuses.
 */
export async function setupAdminAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  if ((await userCount()) > 0) {
    return { success: false, error: "Die Anwendung ist bereits eingerichtet." };
  }

  const parsed = setupAdminSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name") ?? undefined,
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  try {
    // Re-check inside a transaction-ish window to avoid two parallel setups.
    if ((await userCount()) > 0) {
      return { success: false, error: "Die Anwendung ist bereits eingerichtet." };
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
    await prisma.user.create({
      data: {
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name,
        passwordHash,
        role: "ADMIN",
      },
    });
  } catch (error) {
    console.error("[setupAdminAction]", error);
    return { success: false, error: "Der Admin-Account konnte nicht angelegt werden." };
  }

  return { success: true };
}

export async function createUserAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();

  const parsed = userCreateSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name") ?? undefined,
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { success: false, error: "Diese E-Mail wird bereits verwendet." };
  }

  try {
    // No admin-set password: create with a random, unusable temp hash and force
    // the user to set their own on first login (mustSetPassword). The temp value
    // is never shared — the first login is passwordless (by e-mail).
    const tempSecret = `temp_${randomUUID()}_${randomUUID()}`;
    const passwordHash = await bcrypt.hash(tempSecret, BCRYPT_ROUNDS);
    await prisma.user.create({
      data: {
        email,
        name: parsed.data.name,
        passwordHash,
        role: parsed.data.role,
        mustSetPassword: true,
      },
    });
  } catch (error) {
    console.error("[createUserAction]", error);
    return { success: false, error: "Der Benutzer konnte nicht angelegt werden." };
  }

  await recordAuditEvent(AUDIT_ACTIONS.userCreate, admin.email, `${email} (${parsed.data.role})`);
  revalidatePath("/settings");
  return { success: true };
}

export async function resetPassword(userId: string, password: string): Promise<ActionState> {
  const admin = await requireAdmin();

  const parsed = passwordResetSchema.safeParse({ userId, password });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: parsed.data.userId }, data: { passwordHash } });
  } catch (error) {
    console.error("[resetPassword]", error);
    return { success: false, error: "Das Passwort konnte nicht zurückgesetzt werden." };
  }

  await recordAuditEvent(AUDIT_ACTIONS.userPassword, admin.email, `Benutzer ${parsed.data.userId}`);
  revalidatePath("/settings");
  return { success: true };
}

export async function changeRole(userId: string, role: UserRole): Promise<ActionState> {
  const admin = await requireAdmin();

  const parsed = roleChangeSchema.safeParse({ userId, role });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  // Never allow demoting the last remaining admin — that would lock everyone out.
  if (parsed.data.role !== "ADMIN") {
    const target = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
    if (target?.role === "ADMIN" && (await adminCount()) <= 1) {
      return { success: false, error: "Der letzte Administrator kann nicht herabgestuft werden." };
    }
  }

  try {
    await prisma.user.update({ where: { id: parsed.data.userId }, data: { role: parsed.data.role } });
  } catch (error) {
    console.error("[changeRole]", error);
    return { success: false, error: "Die Rolle konnte nicht geändert werden." };
  }

  await recordAuditEvent(
    AUDIT_ACTIONS.userRole,
    admin.email,
    `Benutzer ${parsed.data.userId} → ${parsed.data.role}`,
  );
  revalidatePath("/settings");
  return { success: true };
}

export async function deleteUser(userId: string): Promise<ActionState> {
  const admin = await requireAdmin();

  if (userId === admin.id) {
    return { success: false, error: "Du kannst deinen eigenen Account nicht löschen." };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    return { success: false, error: "Benutzer nicht gefunden." };
  }
  if (target.role === "ADMIN" && (await adminCount()) <= 1) {
    return { success: false, error: "Der letzte Administrator kann nicht gelöscht werden." };
  }

  try {
    await prisma.user.delete({ where: { id: userId } });
  } catch (error) {
    console.error("[deleteUser]", error);
    return { success: false, error: "Der Benutzer konnte nicht gelöscht werden." };
  }

  await recordAuditEvent(AUDIT_ACTIONS.userDelete, admin.email, target.email);
  revalidatePath("/settings");
  return { success: true };
}
