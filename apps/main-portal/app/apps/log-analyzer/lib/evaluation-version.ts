import { DEFAULT_VEHICLE_SPEC, limitsForSpec } from "./vehicle-spec";

// Fingerprint of "what the evaluation engine would say today".
//
// Stored logs cache their evaluated pull-status and hardware-health so the
// overview does not have to re-parse every raw CSV on every read (see
// `log-repository.ts`). That cache is only safe if we can tell when the verdict
// would have changed — which is exactly what this fingerprint is for: a row
// whose `evalVersion` still matches is trusted, anything else is re-evaluated
// from its CSV and re-persisted. So the documented behaviour is preserved
// ("threshold change re-scores every existing log") without the cost.
//
// The fingerprint has two halves:
//
//   * an automatic hash over the threshold TABLES, so editing a limit in
//     `engines.ts` / `vehicle-spec.ts` invalidates the cache by itself, and
//   * `EVALUATION_RULES_VERSION`, a manual counter for changes to the evaluation
//     LOGIC (`evaluate-log-pull.ts` — pull detection, alert rules, debouncing),
//     which no data hash can observe.
//
// >>> Bump EVALUATION_RULES_VERSION whenever you change how a log is judged
// >>> without changing a threshold value. Forgetting to leaves already-stored
// >>> logs showing their previous badge until they are re-uploaded.

/** Manual counter — see the note above. */
export const EVALUATION_RULES_VERSION = 1;

/** FNV-1a, hex. Small, dependency-free, and stable across processes. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** JSON with sorted keys, so the hash can't shift on property reordering. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val,
  );
}

// Stored logs are always scored against DEFAULT_VEHICLE_SPEC (the repository has
// no per-log spec), so the limits derived from exactly that spec are the whole
// threshold surface the cached verdicts depend on.
const THRESHOLD_FINGERPRINT = fnv1a(stableStringify(limitsForSpec(DEFAULT_VEHICLE_SPEC)));

/** Value persisted alongside a log's cached status/health. */
export const EVALUATION_VERSION = `${EVALUATION_RULES_VERSION}-${THRESHOLD_FINGERPRINT}`;
