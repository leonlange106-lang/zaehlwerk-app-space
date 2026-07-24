import { prisma } from "@zaehlwerk/database";

// Append-only audit trail for compliance. Recording is ALWAYS best-effort: a
// failure to write the log must never break the action being logged, so every
// write is wrapped and swallowed with a server-side console error.
//
// Plain server module (not "use server") so it can export the action constants
// and be called from routes, the scheduler and other server actions alike.

export const AUDIT_ACTIONS = {
  systemUpdate: "system.update",
  userCreate: "user.create",
  userDelete: "user.delete",
  userRole: "user.role",
  userPassword: "user.password",
  userApps: "user.apps",
  tokenCreate: "token.create",
  tokenDelete: "token.delete",
  ingestionKeyCreate: "ingestionkey.create",
  ingestionKeyDelete: "ingestionkey.delete",
  logIngest: "loganalyzer.ingest",
  dataImport: "data.import",
  dataRestore: "data.restore",
  backupCreate: "backup.create",
  backupDelete: "backup.delete",
  backupPrune: "backup.prune",
  backupPolicy: "backup.policy",
  dbVacuum: "db.vacuum",
  dbOptimize: "db.optimize",
  logPrune: "loganalyzer.prune",
  logRetentionPolicy: "loganalyzer.retention",
} as const;

export type AuditEvent = {
  id: string;
  action: string;
  actor: string;
  detail: string | null;
  createdAt: Date;
};

// Keep the table lean on a home-server SQLite DB: trim to the newest N rows
// occasionally rather than on every write.
const MAX_AUDIT_ROWS = 2000;
const TRIM_PROBABILITY = 0.05;

/** Record a critical system action. Never throws. */
export async function recordAuditEvent(
  action: string,
  actor: string,
  detail?: string | null,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { action, actor, detail: detail ?? null },
    });
    if (Math.random() < TRIM_PROBABILITY) await trimAuditLog();
  } catch (error) {
    console.error("[recordAuditEvent]", action, error);
  }
}

async function trimAuditLog(): Promise<void> {
  try {
    const total = await prisma.auditLog.count();
    if (total <= MAX_AUDIT_ROWS) return;
    const cutoff = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: MAX_AUDIT_ROWS,
      take: 1,
      select: { createdAt: true },
    });
    const boundary = cutoff[0]?.createdAt;
    if (boundary) {
      await prisma.auditLog.deleteMany({ where: { createdAt: { lt: boundary } } });
    }
  } catch (error) {
    console.error("[trimAuditLog]", error);
  }
}

export async function listAuditEvents(limit = 100): Promise<AuditEvent[]> {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
}
