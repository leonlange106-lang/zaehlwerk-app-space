// Cross-platform ("universal") datalog safety thresholds for modern turbo petrol
// ECUs — Bosch MG1/MEVD17 on the BMW B48/B58/N55/N54/S55/S58 families and their
// MHD / MGflasher / bootmod3 logging exports.
//
// This module COMPLEMENTS `engines.ts`: the per-engine table there scales
// boost/knock/fuel-trim baselines by displacement, turbo count and redline (a
// small B48 tolerates very different absolute boost than a twin-turbo S55). The
// constants HERE are the values that are *physical/chemical* rather than
// displacement-scaled — a lean mixture, a heat-soaked charge, a cumulative
// timing pull across cylinders or a single-sample sensor glitch mean the same
// thing on any of these engines. Keeping them in one, heavily-commented place is
// the "Engine Profile Config System" the analyzer reasons against; the exact
// per-build numbers are then assembled in `vehicle-spec.ts` (`limitsForSpec`).
//
// ── Research basis ──────────────────────────────────────────────────────────
// These are conservative *datalog-flagging heuristics*, NOT manufacturer specs.
// They were cross-checked against widely-used community/tuner references:
//   • EcuTek "B58 Tuning Guide" — WOT lambda/AFR targets; guidance to keep the
//     leanest commanded lambda no leaner than ~0.90, richer under high load.
//   • Boost Monkey "Interpreting MHD Datalogs (N54/N55)" — how timing-correction
//     / knock-retard channels read, and expected WOT AFR bands.
//   • JB4tech B58/B48 AFR discussion — real-world WOT lambda sits ~0.80–0.88 on
//     pump fuel; sustained readings leaner than that correlate with knock/EGT.
// Every constant below states the reasoning inline so a tuner can adjust it.

/**
 * Leanest lambda (λ) tolerated under sustained Wide-Open-Throttle before a
 * lean-mixture warning is raised (petrol baseline).
 *
 * A safe WOT petrol tune commands roughly λ 0.80–0.88 (AFR ≈ 11.8–12.9) to keep
 * combustion cool and knock-safe under boost. Lambda 1.0 is stoichiometric
 * (AFR 14.7) — fine at cruise, dangerous at full load. We flag a *sustained*
 * excursion leaner than 0.88: leaner-than-target under load drives EGT up and
 * erodes the knock margin. The check is WOT-only and debounced so a momentary
 * lean spike during a shift/tip-in never trips it.
 */
export const LAMBDA_WOT_LEAN_LIMIT = 0.88;

/**
 * Intake-air (charge) temperature (°C) above which we warn about heat-driven
 * timing retard. Once the charge crosses ~50 °C the DME starts pulling ignition
 * advance to preserve knock margin, so a sustained high IAT both costs power and
 * signals a heat-soaked intercooler / insufficient cooling between pulls. Warning
 * severity — it degrades the run rather than immediately endangering hardware.
 */
export const IAT_RETARD_WARN_C = 50;

/**
 * Extra degrees of retard (added to the per-cylinder single-cylinder knock
 * threshold) at which the *cumulative* correction summed across all cylinders is
 * flagged. Example: a −3.0° single-cylinder limit → −5.0° cumulative limit. A
 * modest pull on several cylinders at once is more concerning than the same pull
 * on one, even when no single cylinder crosses its own limit.
 */
export const KNOCK_TOTAL_OFFSET_DEG = 2;

/**
 * Debounce / transient-suppression window: the minimum number of *consecutive*
 * in-window samples a threshold must be breached before an alert is raised. ECU
 * logs are noisy — a single frame can spike from a sensor glitch, a logging
 * hiccup or a gear shift. Requiring a breach the ECU actually held for ≥3 samples
 * eliminates single-sample false positives while still catching any real event
 * (genuine knock, overboost, fuel starvation all persist for many samples).
 */
export const DEBOUNCE_SAMPLES = 3;

/**
 * Convert a raw fueling reading to lambda. Logs expose either lambda (~0.7–1.2)
 * or AFR (~10–16, petrol stoich 14.7); we normalise by magnitude so the lean
 * check reasons in a single unit regardless of platform (MHD tends to log AFR,
 * MGflasher lambda).
 */
export function toLambda(value: number): number {
  return value > 3 ? value / 14.7 : value;
}
