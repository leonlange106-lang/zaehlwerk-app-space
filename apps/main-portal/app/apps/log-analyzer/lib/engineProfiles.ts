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
 * Leanest lambda (λ) tolerated under sustained, LOADED Wide-Open-Throttle before
 * a lean-mixture warning is raised (petrol baseline).
 *
 * A safe WOT petrol tune commands roughly λ 0.82–0.90 (AFR ≈ 12.1–13.2). Real
 * reference B58 Stage-1 pulls settle to ~0.88–0.90 at redline — at-target, not a
 * fault — so the limit sits at 0.92: leaner than that under real load (toward
 * stoich λ 1.0) drives EGT up and erodes the knock margin. Genuine lean events
 * (fuel starvation, injector shortfall) read 0.95–1.1 and are still caught.
 *
 * Crucially the check is gated to the LOAD-CRITICAL zone (see LAMBDA_MIN_*_FRAC):
 * during spool-up / tip-in the mixture legitimately sits near λ 1.0 while fuel
 * enrichment ramps in — normal behaviour that must NOT be flagged.
 */
export const LAMBDA_WOT_LEAN_LIMIT = 0.92;

/**
 * Lambda readings outside this plausibility band are treated as invalid sensor
 * frames (overrun fuel-cut / DFCO pegs the reading high, a disconnected sensor
 * reads extreme) and skipped — never converted, never flagged.
 */
export const LAMBDA_VALID_MIN = 0.5;
export const LAMBDA_VALID_MAX = 1.5;

/**
 * The lean check only evaluates the load-critical part of the pull, where fuel
 * enrichment has stabilised and cylinder pressure is highest — i.e. rpm at/above
 * this fraction of the pull's peak rpm AND boost at/above LAMBDA_MIN_BOOST_FRAC
 * of peak boost. Below that lies the spool/tip-in transient (naturally lean),
 * which is normal and excluded. Values verified against real reference logs:
 * this cleanly separates the harmless ramp-in blip from a genuine top-end lean.
 */
export const LAMBDA_MIN_RPM_FRAC = 0.7;
export const LAMBDA_MIN_BOOST_FRAC = 0.9;

/**
 * Intake-air (charge) temperature (°C) above which we warn about heat-driven
 * timing retard. Once the charge crosses ~50 °C the DME starts pulling ignition
 * advance to preserve knock margin, so a sustained high IAT both costs power and
 * signals a heat-soaked intercooler / insufficient cooling between pulls. Warning
 * severity — it degrades the run rather than immediately endangering hardware.
 */
export const IAT_RETARD_WARN_C = 50;

/**
 * Cumulative cross-cylinder knock check: fraction of "every cylinder at the
 * single-cylinder limit at once" at which the summed correction is flagged. The
 * cumulative limit is derived at evaluation time as
 * `knockCorrection × cylinderCount × KNOCK_TOTAL_SHARE`, so it scales with the
 * number of cylinders actually logged (a raw fixed sum is meaningless — 4
 * cylinders each pulling a normal ~−2.8° already sums past −10°). At 0.9 it fires
 * only when nearly all cylinders are pulling close to their individual limit
 * simultaneously — the genuinely-distributed pull the single-cylinder check
 * misses. It is additionally suppressed whenever the single-cylinder check has
 * already fired, so one bad cylinder is never double-reported.
 */
export const KNOCK_TOTAL_SHARE = 0.9;

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
 * Convert a raw fueling reading to lambda, using the channel's UNIT when known.
 * Logs expose either lambda (~0.7–1.2) or AFR (~10–16, petrol stoich 14.7). We
 * trust an explicit unit first — a lambda-unit channel is never divided (a stray
 * overrun spike to 3.3 stays 3.3 and is later rejected as invalid, rather than
 * being mis-read as AFR 3.3 → λ 0.22). Only a unit-less channel falls back to a
 * magnitude heuristic (MHD tends to log AFR, MGflasher lambda).
 */
export function toLambda(value: number, unit?: string | null): number {
  const u = (unit ?? "").toLowerCase();
  if (u.includes("afr")) return value / 14.7;
  if (u.includes("lambda") || u.includes("λ")) return value;
  return value > 3 ? value / 14.7 : value;
}
