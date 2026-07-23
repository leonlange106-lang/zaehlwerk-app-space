import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimits, clientIdentifier, rateLimit } from "./rate-limit";

beforeEach(() => __resetRateLimits());

describe("rateLimit (fixed window)", () => {
  it("allows requests up to the limit, then blocks", () => {
    const opts = { key: "k", limit: 3, windowMs: 1000, now: 0 };
    expect(rateLimit(opts).ok).toBe(true); // 1
    expect(rateLimit(opts).ok).toBe(true); // 2
    const third = rateLimit(opts); // 3
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
    expect(rateLimit(opts).ok).toBe(false); // 4 → blocked
  });

  it("resets after the window elapses", () => {
    expect(rateLimit({ key: "k", limit: 1, windowMs: 1000, now: 0 }).ok).toBe(true);
    expect(rateLimit({ key: "k", limit: 1, windowMs: 1000, now: 500 }).ok).toBe(false);
    // New window at t=1000.
    expect(rateLimit({ key: "k", limit: 1, windowMs: 1000, now: 1000 }).ok).toBe(true);
  });

  it("keeps separate counters per key", () => {
    expect(rateLimit({ key: "a", limit: 1, windowMs: 1000, now: 0 }).ok).toBe(true);
    expect(rateLimit({ key: "b", limit: 1, windowMs: 1000, now: 0 }).ok).toBe(true);
    expect(rateLimit({ key: "a", limit: 1, windowMs: 1000, now: 0 }).ok).toBe(false);
  });

  it("reports a positive retryAfter while blocked", () => {
    rateLimit({ key: "k", limit: 1, windowMs: 10_000, now: 0 });
    const blocked = rateLimit({ key: "k", limit: 1, windowMs: 10_000, now: 2000 });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(8);
  });
});

describe("clientIdentifier", () => {
  it("uses the first x-forwarded-for hop", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientIdentifier(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(clientIdentifier(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe(
      "9.9.9.9",
    );
    expect(clientIdentifier(new Request("http://x"))).toBe("unknown");
  });
});
