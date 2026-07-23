"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@zaehlwerk/database";
import { getSessionUser } from "./auth-helpers";
import { generateApiToken, hashToken } from "./crypto";
import { AUDIT_ACTIONS, recordAuditEvent } from "./audit";

export type ApiTokenSummary = {
  id: string;
  name: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

export async function listApiTokens(): Promise<ApiTokenSummary[]> {
  const user = await getSessionUser();
  if (!user) return [];
  return prisma.apiToken.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, lastUsedAt: true, expiresAt: true, createdAt: true },
  });
}

/**
 * Namen + Ids der aktiven (nicht abgelaufenen) Tokens des Nutzers — für den
 * Smart-Home-Snippet-Generator. Bewusst hier (Server-Action-Modul) und nicht in
 * einer Komponente, damit das `Date.now()` außerhalb des React-Renders liegt.
 */
export async function listActiveApiTokens(): Promise<{ id: string; name: string }[]> {
  const now = Date.now();
  const tokens = await listApiTokens();
  return tokens
    .filter((token) => !token.expiresAt || token.expiresAt.getTime() > now)
    .map((token) => ({ id: token.id, name: token.name }));
}

/**
 * Create a PAT for the current user. Returns the plaintext token ONCE — only its
 * SHA-256 hash is stored, so it can never be shown again.
 */
export async function createApiToken(
  name: string,
  expiresInDays?: number | null,
): Promise<{ success: true; token: string } | { success: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { success: false, error: "Nicht angemeldet." };

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Bitte einen Namen angeben." };
  if (trimmed.length > 80) return { success: false, error: "Name ist zu lang." };

  let expiresAt: Date | null = null;
  if (expiresInDays && expiresInDays > 0) {
    expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  }

  const token = generateApiToken();
  try {
    await prisma.apiToken.create({
      data: { name: trimmed, tokenHash: hashToken(token), userId: user.id, expiresAt },
    });
  } catch (error) {
    console.error("[createApiToken]", error);
    return { success: false, error: "Token konnte nicht erstellt werden." };
  }

  await recordAuditEvent(AUDIT_ACTIONS.tokenCreate, user.email, `„${trimmed}"`);
  revalidatePath("/settings");
  return { success: true, token };
}

export async function deleteApiToken(id: string): Promise<{ success: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { success: false, error: "Nicht angemeldet." };

  try {
    // Scope to the owner so nobody can revoke someone else's token by id.
    await prisma.apiToken.deleteMany({ where: { id, userId: user.id } });
  } catch (error) {
    console.error("[deleteApiToken]", error);
    return { success: false, error: "Token konnte nicht gelöscht werden." };
  }

  await recordAuditEvent(AUDIT_ACTIONS.tokenDelete, user.email, id);
  revalidatePath("/settings");
  return { success: true };
}
