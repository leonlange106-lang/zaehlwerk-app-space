import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, userCountMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  userCountMock: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@zaehlwerk/database", () => ({ prisma: { user: { count: userCountMock } } }));

import { adminCount, getSessionUser, requireAdmin, userCount } from "./auth-helpers";

beforeEach(() => {
  authMock.mockReset();
  userCountMock.mockReset();
});

describe("getSessionUser", () => {
  it("maps a session into a SessionUser", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "a@b.de", name: "A", role: "USER" } });
    expect(await getSessionUser()).toEqual({ id: "u1", email: "a@b.de", name: "A", role: "USER" });
  });

  it("returns null without a session", async () => {
    authMock.mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
  });
});

describe("requireAdmin (RBAC guard)", () => {
  it("returns the user when they are an ADMIN", async () => {
    authMock.mockResolvedValue({ user: { id: "a1", email: "admin@b.de", role: "ADMIN" } });
    const user = await requireAdmin();
    expect(user.role).toBe("ADMIN");
  });

  it("throws for a normal USER (no admin actions)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "user@b.de", role: "USER" } });
    await expect(requireAdmin()).rejects.toThrow("Nicht autorisiert.");
  });

  it("throws for an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toThrow("Nicht autorisiert.");
  });
});

describe("user counts", () => {
  it("delegates to prisma.user.count", async () => {
    userCountMock.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    expect(await userCount()).toBe(3);
    expect(await adminCount()).toBe(1);
    expect(userCountMock).toHaveBeenLastCalledWith({ where: { role: "ADMIN" } });
  });
});
