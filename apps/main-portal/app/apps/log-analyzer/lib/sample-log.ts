// Synthetic sample datalog for the "Beispiel laden" affordance and E2E tests.
// Entirely fabricated numbers — NO real vehicle data or share links — modelling
// a single 3rd-gear pull from idle to redline so every parameter group has a
// plausible-looking curve to demonstrate the charts.

/** Generate a synthetic MGflasher-style CSV log as a string. */
export function makeSampleCsv(): string {
  const header = [
    "# VIN: WBSDEMO0SYNTHETIC1",
    "# Vehicle: Synthetic Demo Coupe",
    "# Map: Stage2 (Demo) v1.0",
    "# Software: MGflasher Demo",
    "# Date: 2024-06-01 14:22",
    [
      "Time (s)",
      "RPM",
      "Boost Target (psi)",
      "Boost Actual (psi)",
      "WGDC (%)",
      "Ignition Timing (deg)",
      "Ignition Correction (deg)",
      "HPFP Pressure (bar)",
      "LPFP Pressure (bar)",
      "STFT (%)",
      "LTFT (%)",
      "IAT (°C)",
      "Gear",
    ].join(","),
  ];

  const rows: string[] = [];
  const steps = 220;
  for (let i = 0; i < steps; i += 1) {
    const t = (i * 0.05).toFixed(2);
    const p = i / (steps - 1); // 0..1 progress through the pull
    const rpm = Math.round(900 + p * (7000 - 900));
    // Boost spools then tapers slightly toward redline.
    const spool = Math.min(1, p * 3);
    const boostTarget = +(spool * 20 - Math.max(0, p - 0.7) * 6).toFixed(2);
    const boostActual = +(boostTarget - 0.6 - Math.sin(p * 12) * 0.4).toFixed(2);
    const wgdc = +(35 + spool * 45 - Math.max(0, p - 0.7) * 20).toFixed(1);
    const ignition = +(14 - spool * 9 + Math.max(0, p - 0.8) * 4).toFixed(2);
    const correction = +(i % 37 === 0 ? -(0.5 + Math.random() * 1.5) : 0).toFixed(2);
    const hpfp = Math.round(60 + spool * 140);
    const lpfp = +(5 + spool * 0.6).toFixed(2);
    const stft = +(Math.sin(p * 20) * 3).toFixed(2);
    const ltft = +(-2 + p * 1).toFixed(2);
    const iat = Math.round(28 + p * 14);
    const gear = 3;
    rows.push(
      [t, rpm, boostTarget, boostActual, wgdc, ignition, correction, hpfp, lpfp, stft, ltft, iat, gear].join(","),
    );
  }

  return [...header, ...rows].join("\n");
}
