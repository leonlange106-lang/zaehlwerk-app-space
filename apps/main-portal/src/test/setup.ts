// Global test setup. The crypto helpers derive every key from AUTH_SECRET, so a
// deterministic secret must exist before any module under test is imported.
// (NODE_ENV is typed read-only by Next's env types, hence the widened cast.)
const env = process.env as Record<string, string | undefined>;
env.AUTH_SECRET ??= "test-secret-do-not-use-in-production-0123456789";
env.NODE_ENV ??= "test";
