import { NextResponse } from "next/server";
import { prisma } from "@zaehlwerk/database";
import { hashToken, safeEqual } from "./crypto";

// Authentication for the automated log-ingestion endpoint. Deliberately separate
// from the user-facing PAT auth (`api-auth.ts`): ingestion keys represent a
// device/integration (Home Assistant, a sync script), not a logged-in user, and
// are accepted via a simple `X-API-Key` header OR `Authorization: Bearer …`.
//
// Two key sources, checked in order:
//   1. A bootstrap key from the `INGESTION_API_KEY` env var — lets a fresh HAOS
//      deployment authenticate before any DB key is minted (compared in constant
//      time). Optional; unset means "DB keys only".
//   2. DB-managed keys (`IngestionKey`), stored only as a SHA-256 hash. Revoked
//      or expired keys are rejected; `lastUsedAt` is stamped best-effort.

export interface IngestionPrincipal {
  /** Key id ("env" for the bootstrap key) — for audit/logging. */
  id: string;
  name: string;
  via: "key" | "env";
}

/** Extract the presented key from `X-API-Key` or a `Bearer` Authorization header. */
export function extractIngestionKey(request: Request): string | null {
  const headerKey = request.headers.get("x-api-key");
  if (headerKey && headerKey.trim()) return headerKey.trim();

  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token) return token;
  }
  return null;
}

/**
 * Authenticate an ingestion request. Returns the principal, or null when no
 * valid key was presented.
 */
export async function authenticateIngestion(request: Request): Promise<IngestionPrincipal | null> {
  const key = extractIngestionKey(request);
  if (!key) return null;

  // 1) Env bootstrap key (constant-time compare so its length/value don't leak).
  const envKey = process.env.INGESTION_API_KEY;
  if (envKey && safeEqual(key, envKey)) {
    return { id: "env", name: "INGESTION_API_KEY", via: "env" };
  }

  // 2) DB-managed key by hash.
  const record = await prisma.ingestionKey.findUnique({
    where: { keyHash: hashToken(key) },
  });
  if (!record) return null;
  if (record.revoked) return null;
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;

  // Best-effort "last used" stamp — never block the request on it.
  void prisma.ingestionKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { id: record.id, name: record.name, via: "key" };
}

export function ingestionUnauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, error: "Ungültiger oder fehlender API-Key." },
    { status: 401 },
  );
}
