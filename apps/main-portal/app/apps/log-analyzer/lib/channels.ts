import type { LogSeries, ParsedLog } from "./types";

// Semantic channel resolution. MGflasher logs name the same signal in many ways
// ("Boost Actual", "Ladedruck Ist", "Boost (psi)"), so the evaluation engine and
// the comparison view can't rely on fixed keys. This module maps the messy raw
// labels onto a small set of canonical *roles* (rpm, throttle, boost target, …)
// via ordered matchers. Pure and dependency-free so it stays unit-testable and
// safe to import from Server, Client and tests alike.

/** Canonical single-value roles the analyzer reasons about. */
export type ChannelRole =
  | "rpm"
  | "throttle"
  | "gear"
  | "boostTarget"
  | "boostActual"
  | "stft"
  | "ltft"
  | "hpfpTarget"
  | "hpfpActual"
  | "egt"
  | "iat"
  | "lambda";

// Order matters within each role: the first matching series wins. The `actual`
// vs `target` split is intentionally strict so a "Boost Target" column never
// gets mistaken for the actual trace and vice-versa.
const ROLE_MATCHERS: Record<ChannelRole, RegExp[]> = {
  rpm: [/\brpm\b/i, /drehzahl/i, /engine\s*speed/i],
  // WOT is decided by the DRIVER input (accelerator pedal), not the throttle
  // plate — on a real pull the pedal is pinned at 100% while the plate ramps
  // open gradually. So pedal/accelerator matchers must win over "throttle".
  throttle: [/pedal/i, /accel/i, /gaspedal/i, /throttle/i, /drossel/i, /\btps\b/i],
  gear: [/\bgear\b/i, /\bgang\b/i, /transmission.*gear/i],
  boostTarget: [/boost.*(target|soll|desired|req)/i, /(target|soll|desired).*boost/i, /ladedruck.*soll/i],
  // Prefer the intake-manifold (charge) pressure — the true boost the engine
  // sees — over ambient/pre-throttle taps that also start with "Boost".
  boostActual: [
    /boost.*(actual|ist|current)/i,
    /(actual|ist).*boost/i,
    /intake\s*manifold/i,
    /manifold.*(press|druck)/i,
    /charge.*(press|druck)/i,
    /ladedruck.*ist/i,
    /^ladedruck\b/i,
    /^boost\b/i,
  ],
  stft: [/\bstft\b/i, /short.*term.*(fuel.*)?trim/i, /fuel.*trim.*short/i],
  ltft: [/\bltft\b/i, /long.*term.*(fuel.*)?trim/i, /fuel.*trim.*long/i],
  hpfpTarget: [/hpfp.*(target|soll|desired)/i, /(rail|fuel).*press.*(target|soll|desired)/i, /(target|soll).*(rail|hpfp)/i],
  hpfpActual: [/hpfp.*(actual|ist|current)/i, /(rail|fuel).*press.*(actual|ist)/i, /^hpfp\b/i],
  egt: [/\begt\b/i, /exhaust.*temp/i, /abgas.*temp/i],
  iat: [/\biat\b/i, /intake.*air.*temp/i, /charge.*air.*temp/i, /ansaug.*temp/i, /ladeluft/i],
  // Air/fuel ratio under load. Logs name it many ways across platforms —
  // "Fuel: Lambda Actual [lambda]" (MGflasher), "Lambda (Bank 1)", "AFR" (MHD).
  // Prefer the ACTUAL/measured trace over a commanded "Lambda Target"; AFR and a
  // bare "Lambda" are accepted as fallbacks (normalised to λ downstream).
  lambda: [
    /lambda.*(actual|ist|measured|bank\s*1|sensor)/i,
    /(actual|ist|measured).*lambda/i,
    /\bafr\b/i,
    /air.?fuel/i,
    /\blambda\b/i,
    /\bλ\b/i,
  ],
};

// Timing/knock corrections deserve special handling: a car logs one channel per
// cylinder, and we want ALL of them (to spot "multiple cylinders" pulling), not
// just the first. These match a *correction/retard/pull* signal — never the
// absolute timing advance, which is a different (positive) quantity.
const TIMING_CORRECTION_MATCHERS: RegExp[] = [
  /(ign(ition)?|timing|z(ü|ue)nd).*(corr|pull|retard|knock|klopf)/i,
  /(knock|klopf).*(corr|retard)/i,
  /\bknock\b/i,
  /\bklopf/i,
  /correction/i,
];

// …but never a plain event COUNTER/flag. A "Knock Detection [0-n]" channel is a
// 0/1/n counter, not a degree of retard — matching `\bknock\b` it would wrongly
// join the correction set and pollute the (negative-degree) knock maths. Exclude
// any label that reads as a count/detection/status/flag rather than an angle.
const TIMING_CORRECTION_EXCLUDE = /detection|count|counter|\bevents?\b|status|\bflag\b/i;

function firstMatch(series: LogSeries[], matchers: RegExp[]): LogSeries | null {
  for (const re of matchers) {
    const hit = series.find((s) => re.test(s.label));
    if (hit) return hit;
  }
  return null;
}

/** The resolved channel map for a parsed log. Any role may be `null` (absent). */
export interface ResolvedChannels {
  rpm: LogSeries | null;
  throttle: LogSeries | null;
  gear: LogSeries | null;
  boostTarget: LogSeries | null;
  boostActual: LogSeries | null;
  stft: LogSeries | null;
  ltft: LogSeries | null;
  hpfpTarget: LogSeries | null;
  hpfpActual: LogSeries | null;
  egt: LogSeries | null;
  iat: LogSeries | null;
  /** Measured air/fuel ratio (λ or AFR — normalise via `toLambda`). */
  lambda: LogSeries | null;
  /** Every timing/knock-correction channel found (one per cylinder, typically). */
  timingCorrections: LogSeries[];
}

/** Map a parsed log's raw series onto canonical channel roles. */
export function resolveChannels(log: ParsedLog): ResolvedChannels {
  const s = log.series;
  const used = new Set<string>();

  // Resolve the strict single roles first and remember what we consumed, so a
  // correction channel can't also be claimed as a plain "timing" role, etc.
  const single = (role: ChannelRole): LogSeries | null => {
    const hit = firstMatch(s, ROLE_MATCHERS[role]);
    if (hit) used.add(hit.key);
    return hit;
  };

  const rpm = single("rpm");
  const throttle = single("throttle");
  const gear = single("gear");
  const boostTarget = single("boostTarget");
  const boostActual = single("boostActual");
  const stft = single("stft");
  const ltft = single("ltft");
  const hpfpTarget = single("hpfpTarget");
  const hpfpActual = single("hpfpActual");
  const egt = single("egt");
  const iat = single("iat");
  const lambda = single("lambda");

  const timingCorrections = s.filter(
    (x) =>
      !used.has(x.key) &&
      TIMING_CORRECTION_MATCHERS.some((re) => re.test(x.label)) &&
      !TIMING_CORRECTION_EXCLUDE.test(x.label),
  );

  return {
    rpm,
    throttle,
    gear,
    boostTarget,
    boostActual,
    stft,
    ltft,
    hpfpTarget,
    hpfpActual,
    egt,
    iat,
    lambda,
    timingCorrections,
  };
}
