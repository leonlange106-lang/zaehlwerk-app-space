import { beforeEach, describe, expect, it, vi } from "vitest";

// Prisma and the session helper are mocked; bcrypt stays real so the hash write
// on the happy path is exercised end to end.
const { userFindUnique, userUpdate, getSessionUser } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock("@zaehlwerk/database", () => ({
  prisma: { user: { findUnique: userFindUnique, update: userUpdate } },
}));
vi.mock("./auth-helpers", () => ({ getSessionUser }));

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
