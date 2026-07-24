"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@zaehlwerk/database";
import { requireAdmin } from "./auth-helpers";
import { generateIngestionKey, hashToken } from "./crypto";
import { AUDIT_ACTIONS, recordAuditEvent } from "./audit";

// Admin management of ingestion API keys (instance-wide, not per-user). Mirrors
// the PAT actions but gated to admins, since these keys let any external system
// push logs into the shared store. Only the plaintext is returned once; the DB
// keeps only the SHA-256 hash.

export type IngestionKeySummary = {
  id: string;
  name: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revoked: boolean;
  createdAt: Date;
};

export async function listIngestionKeys(): Promise<IngestionKeySummary[]> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return [];
  return prisma.ingestionKey.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, lastUsedAt: true, expiresAt: true, revoked: true, createdAt: true },
  });
}

export async function createIngestionKey(
  name: string,
  expiresInDays?: number | null,
): Promise<{ success: true; key: string } | { success: false; error: string }> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { success: false, error: "Nur Admins dürfen Ingestion-Keys verwalten." };

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Bitte einen Namen angeben." };
  if (trimmed.length > 80) return { success: false, error: "Name ist zu lang." };

  let expiresAt: Date | null = null;
  if (expiresInDays && expiresInDays > 0) {
    expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  }

  const key = generateIngestionKey();
  try {
    await prisma.ingestionKey.create({
      data: { name: trimmed, keyHash: hashToken(key), expiresAt },
    });
  } catch (error) {
    console.error("[createIngestionKey]", error);
    return { success: false, error: "Key konnte nicht erstellt werden." };
  }

  await recordAuditEvent(AUDIT_ACTIONS.ingestionKeyCreate, admin.email, `„${trimmed}"`);
  revalidatePath("/settings");
  return { success: true, key };
}

/** Revoke (soft-delete) a key so it stays as an audit trace but stops working. */
export async function revokeIngestionKey(id: string): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdmin().catch(() => null);
  if (!admin) return { success: false, error: "Nur Admins dürfen Ingestion-Keys verwalten." };

  try {
    await prisma.ingestionKey.update({ where: { id }, data: { revoked: true } });
  } catch (error) {
    console.error("[revokeIngestionKey]", error);
    return { success: false, error: "Key konnte nicht widerrufen werden." };
  }

  await recordAuditEvent(AUDIT_ACTIONS.ingestionKeyDelete, admin.email, id);
  revalidatePath("/settings");
  return { success: true };
}
