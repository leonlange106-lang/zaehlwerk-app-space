// Lightweight in-process fixed-window rate limiter. Deliberately dependency-free
// and in-memory: this is a single-instance home-server app (one Node process, one
// SQLite DB), so a shared store like Redis would be over-engineering. It caps
// brute-force / runaway automation against the auth- and token-authenticated API
// endpoints without any external moving parts.
//
// Trade-off: state is per-process and resets on restart. That's fine here — the
// goal is throttling abuse, not durable quota accounting.

export interface RateLimitResult {
  /** Whether this request is allowed (under the limit). */
  ok: boolean;
  /** Remaining requests in the current window after counting this one. */
  remaining: number;
  /** Unix-ms timestamp when the current window resets. */
  resetAt: number;
  /** Seconds until reset — convenient for a Retry-After header. */
  retryAfter: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Occasionally sweep expired buckets so the map can't grow without bound under a
// stream of unique keys (e.g. rotating source IPs). Cheap and amortized.
const SWEEP_PROBABILITY = 0.01;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  /** Unique key for the caller (e.g. `readings:<ip>` or `login:<email>`). */
  key: string;
  /** Max requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Injectable clock for deterministic tests. */
  now?: number;
  /**
   * Nur nachsehen, nicht mitzaehlen.
   *
   * Fuer den Fall, dass jemand NACH einer Ablehnung wissen muss, ob die Bremse
   * der Grund war — eine Diagnose darf den Zaehler nicht weiterdrehen, sonst
   * sperrt sich der Nutzer durchs Nachfragen selbst aus.
   */
  peek?: boolean;
}

/**
 * Count one hit against `key` and report whether it's within `limit` per
 * `windowMs`. The first request in a window starts the clock; subsequent hits
 * increment until the window rolls over.
 */
export function rateLimit({ key, limit, windowMs, now = Date.now(), peek = false }: RateLimitOptions): RateLimitResult {
  if (Math.random() < SWEEP_PROBABILITY) sweep(now);

  const existing = buckets.get(key);

  if (peek) {
    if (!existing || existing.resetAt <= now) {
      return { ok: true, remaining: limit, resetAt: now + windowMs, retryAfter: 0 };
    }
    return {
      ok: existing.count <= limit,
      remaining: Math.max(0, limit - existing.count),
      resetAt: existing.resetAt,
      retryAfter: Math.max(0, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt, retryAfter: Math.ceil(windowMs / 1000) };
  }

  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);
  const retryAfter = Math.max(0, Math.ceil((existing.resetAt - now) / 1000));
  return { ok: existing.count <= limit, remaining, resetAt: existing.resetAt, retryAfter };
}

/** Best-effort caller identity for rate-limit keys: the first forwarded IP, else a fallback. */
export function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test-only: clear all buckets between cases. */
export function __resetRateLimits(): void {
  buckets.clear();
}
