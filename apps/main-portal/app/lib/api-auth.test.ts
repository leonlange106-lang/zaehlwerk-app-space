import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks -----------------------------------------------------------------
// Auth.js session lookup and the Prisma client are the only external deps.
// vi.hoisted keeps these defined before the hoisted vi.mock factories run.
const { authMock, apiTokenFindUnique, apiTokenUpdate } = vi.hoisted(() => ({
  authMock: vi.fn(),
  apiTokenFindUnique: vi.fn(),
  apiTokenUpdate: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@zaehlwerk/database", () => ({
  prisma: { apiToken: { findUnique: apiTokenFindUnique, update: apiTokenUpdate } },
}));

import { authenticateApiRequest } from "./api-auth";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/readings", { headers });
}

beforeEach(() => {
  authMock.mockReset();
  apiTokenFindUnique.mockReset();
  apiTokenUpdate.mockClear();
});

describe("authenticateApiRequest — session path", () => {
  it("returns the session user without consulting tokens", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "a@b.de", role: "ADMIN" } });
    const user = await authenticateApiRequest(req());
    expect(user).toEqual({ id: "u1", email: "a@b.de", role: "ADMIN", via: "session" });
    expect(apiTokenFindUnique).not.toHaveBeenCalled();
  });
});

describe("authenticateApiRequest — token path", () => {
  beforeEach(() => authMock.mockResolvedValue(null));

  it("rejects a request with no session and no bearer", async () => {
    expect(await authenticateApiRequest(req())).toBeNull();
  });

  it("rejects a bearer that is not a zw_pat_ token", async () => {
    const user = await authenticateApiRequest(req({ authorization: "Bearer some.jwt.value" }));
    expect(user).toBeNull();
    expect(apiTokenFindUnique).not.toHaveBeenCalled();
  });

  it("rejects an unknown token", async () => {
    apiTokenFindUnique.mockResolvedValue(null);
    const user = await authenticateApiRequest(req({ authorization: "Bearer zw_pat_unknown" }));
    expect(user).toBeNull();
  });

  it("accepts a valid token and stamps lastUsedAt best-effort", async () => {
    apiTokenFindUnique.mockResolvedValue({
      id: "tok1",
      expiresAt: null,
      user: { id: "u2", email: "dev@b.de", role: "USER" },
    });
    const user = await authenticateApiRequest(req({ authorization: "Bearer zw_pat_valid" }));
    expect(user).toEqual({ id: "u2", email: "dev@b.de", role: "USER", via: "token" });
    expect(apiTokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tok1" } }),
    );
  });

  it("rejects an expired token", async () => {
    apiTokenFindUnique.mockResolvedValue({
      id: "tok2",
      expiresAt: new Date(Date.now() - 1000),
      user: { id: "u3", email: "old@b.de", role: "USER" },
    });
    const user = await authenticateApiRequest(req({ authorization: "Bearer zw_pat_expired" }));
    expect(user).toBeNull();
  });

  it("does not reject the request if the lastUsedAt update fails", async () => {
    apiTokenFindUnique.mockResolvedValue({
      id: "tok3",
      expiresAt: null,
      user: { id: "u4", email: "x@b.de", role: "USER" },
    });
    apiTokenUpdate.mockRejectedValueOnce(new Error("db locked"));
    const user = await authenticateApiRequest(req({ authorization: "Bearer zw_pat_ok" }));
    expect(user?.id).toBe("u4");
  });
});
