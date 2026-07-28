import { beforeEach, describe, expect, it, vi } from "vitest";

// Prisma and the session helper are mocked; bcrypt stays real so the hash write
// on the happy path is exercised end to end.
const { userFindUnique, userUpdate, getSessionUser, auditCreate } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  getSessionUser: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@zaehlwerk/database", () => ({
  prisma: {
    user: { findUnique: userFindUnique, update: userUpdate },
    // Die Anmeldung schreibt Fehlversuche mit — ohne das greift der Audit-Pfad
    // ins Leere und der Test bricht an einer Stelle ab, die er nicht prueft.
    auditLog: { create: auditCreate, count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("./auth-helpers", () => ({ getSessionUser }));

// `headers()`/`cookies()` gibt es ausserhalb einer Anfrage nicht. Die Bremse
// liest die Absenderadresse aus den Kopfzeilen, deshalb hier ein leerer Satz —
// der faellt in callerIdentity() auf "unknown" zurueck, was fuer diese Tests
// genau richtig ist: Sie pruefen die Anmeldelogik, nicht die Zaehlung.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }),
}));

import { beginLoginAction, completePasswordSetupAction } from "./login-actions";

beforeEach(() => {
  userFindUnique.mockReset();
  userUpdate.mockReset().mockResolvedValue({});
  getSessionUser.mockReset();
});

describe("beginLoginAction — temp-password accounts", () => {
  it("reports mustSetPassword without checking a password", async () => {
    userFindUnique.mockResolvedValue({
      id: "u1",
      email: "new@user.de",
      passwordHash: "irrelevant",
      mustSetPassword: true,
      twoFactorEnabled: false,
    });
    const res = await beginLoginAction("new@user.de", "");
    expect(res).toEqual({ ok: true, mustSetPassword: true });
  });

  it("does not leak whether an unknown email exists", async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await beginLoginAction("nobody@user.de", "whatever");
    expect(res).toEqual({ ok: false });
  });
});

describe("completePasswordSetupAction", () => {
  it("rejects when not signed in", async () => {
    getSessionUser.mockResolvedValue(null);
    const res = await completePasswordSetupAction("longenoughpw");
    expect(res.success).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("rejects a too-short password", async () => {
    getSessionUser.mockResolvedValue({ id: "u1", email: "a@b.de", name: null, role: "USER" });
    const res = await completePasswordSetupAction("short");
    expect(res.success).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op success when the account already has a real password", async () => {
    getSessionUser.mockResolvedValue({ id: "u1", email: "a@b.de", name: null, role: "USER" });
    userFindUnique.mockResolvedValue({ id: "u1", mustSetPassword: false });
    const res = await completePasswordSetupAction("longenoughpw");
    expect(res.success).toBe(true);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("stores a hash and clears the flag on success", async () => {
    getSessionUser.mockResolvedValue({ id: "u1", email: "a@b.de", name: null, role: "USER" });
    userFindUnique.mockResolvedValue({ id: "u1", mustSetPassword: true });
    const res = await completePasswordSetupAction("longenoughpw");
    expect(res.success).toBe(true);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    const arg = userUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "u1" });
    expect(arg.data.mustSetPassword).toBe(false);
    expect(typeof arg.data.passwordHash).toBe("string");
    expect(arg.data.passwordHash).not.toBe("longenoughpw"); // hashed, not plaintext
  });
});
