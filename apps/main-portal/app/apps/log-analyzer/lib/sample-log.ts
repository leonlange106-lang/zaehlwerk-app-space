// Synthetic sample datalogs for the "Beispiel laden" affordance, the comparison
// view and E2E tests. Entirely fabricated numbers — NO real vehicle data or
// share links — modelling a single 3rd-gear WOT pull from idle to redline so
// every parameter group (and the evaluation engine) has plausible data to work
// with.

interface SampleOptions {
  /** Header VIN so callers can tell two generated samples apart. */
  vin?: string;
  vehicle?: string;
  map?: string;
  /** Peak boost the pull tops out at (psi). Drives the whole boost curve. */
  peakBoost?: number;
  /** If set, inject a knock event: correction dips to this many degrees. */
  knockDeg?: number;
  /** Peak intake air temp (°C). */
  peakIat?: number;
}

/** Generate a synthetic MGflasher-style CSV log as a string. */
export function makeSampleCsv(opts: SampleOptions = {}): string {
  const {
    vin = "WBSDEMO0SYNTHETIC1",
    vehicle = "Synthetic Demo Coupe",
    map = "Stage2 (Demo) v1.0",
    peakBoost = 20,
    knockDeg = 0,
    peakIat = 42,
  } = opts;

  const header = [
    `# VIN: ${vin}`,
    `# Vehicle: ${vehicle}`,
    `# Map: ${map}`,
    "# Software: MGflasher Demo",
    "# Date: 2024-06-01 14:22",
    [
      "Time (s)",
      "RPM",
      "Pedal (%)",
      "Boost Target (psi)",
      "Boost Actual (psi)",
      "WGDC (%)",
      "Ignition Timing (deg)",
      "Ignition Correction (deg)",
      "HPFP Pressure (bar)",
      "LPFP Pressure (bar)",
      "STFT (%)",
      "LTFT (%)",
      "Lambda Actual (λ)",
      "IAT (°C)",
      "EGT (°C)",
      "Gear",
    ].join(","),
  ];

  const rows: string[] = [];
  const steps = 220;
  for (let i = 0; i < steps; i += 1) {
    const t = (i * 0.05).toFixed(2);
    const p = i / (steps - 1); // 0..1 progress through the pull
    const rpm = Math.round(900 + p * (7000 - 900));
    // Full throttle once the driver tips in (first ~5% of the log is roll-on).
    const pedal = p < 0.05 ? Math.round((p / 0.05) * 100) : 100;
    // Boost spools then tapers slightly toward redline.
    const spool = Math.min(1, p * 3);
    const boostTarget = +(spool * peakBoost - Math.max(0, p - 0.7) * (peakBoost * 0.3)).toFixed(2);
    const boostActual = +(boostTarget - 0.6 - Math.sin(p * 12) * 0.4).toFixed(2);
    const wgdc = +(35 + spool * 45 - Math.max(0, p - 0.7) * 20).toFixed(1);
    const ignition = +(14 - spool * 9 + Math.max(0, p - 0.8) * 4).toFixed(2);
    // A deterministic knock dip around mid-pull when requested (no RNG so E2E
    // and unit expectations stay stable).
    const knock = knockDeg < 0 && i >= 120 && i <= 128 ? knockDeg : 0;
    const correction = +knock.toFixed(2);
    const hpfp = Math.round(60 + spool * 140);
    const lpfp = +(5 + spool * 0.6).toFixed(2);
    const stft = +(Math.sin(p * 20) * 3).toFixed(2);
    const ltft = +(-2 + p * 1).toFixed(2);
    // Enrichment ramps in with boost: ~1.0 off-load down to ~0.85 at full load —
    // safely rich of the WOT lean limit, so the sample stays alert-free.
    const lambda = +(1.0 - spool * 0.15).toFixed(3);
    const iat = Math.round(28 + p * (peakIat - 28));
    const egt = Math.round(400 + spool * 450 + Math.max(0, p - 0.7) * 60);
    const gear = 3;
    rows.push(
      [
        t,
        rpm,
        pedal,
        boostTarget,
        boostActual,
        wgdc,
        ignition,
        correction,
        hpfp,
        lpfp,
        stft,
        ltft,
        lambda,
        iat,
        egt,
        gear,
      ].join(","),
    );
  }

  return [...header, ...rows].join("\n");
}
