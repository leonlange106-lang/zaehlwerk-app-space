import { describe, expect, it } from "vitest";
import { resolveChannels } from "./channels";
import { makeLog } from "./test-helpers";

// SYNTHETIC fixtures only.

/** Resolve a log built from bare labels (values are irrelevant to matching). */
function resolve(labels: string[]) {
  return resolveChannels(makeLog(labels.map((label) => ({ label, values: [0, 1] }))));
}

describe("resolveChannels — ignition timing vs. correction", () => {
  it("resolves the absolute advance channel", () => {
    for (const label of ["Ignition Timing", "Ignition Advance", "Zündwinkel", "Timing Angle"]) {
      expect(resolve([label]).ignitionTiming?.label, label).toBe(label);
    }
  });

  it("never claims a correction channel as the absolute advance", () => {
    const ch = resolve(["Ignition Timing Correction Cyl 1", "Knock Retard"]);
    expect(ch.ignitionTiming).toBeNull();
    expect(ch.timingCorrections.map((s) => s.label)).toEqual([
      "Ignition Timing Correction Cyl 1",
      "Knock Retard",
    ]);
  });

  it("keeps both roles apart when a log carries advance AND corrections", () => {
    const ch = resolve([
      "Ignition Timing",
      "Ignition Timing Correction Cyl 1",
      "Ignition Timing Correction Cyl 2",
    ]);
    expect(ch.ignitionTiming?.label).toBe("Ignition Timing");
    // Crucially, the advance must not be consumed from the correction set —
    // and no correction may go missing because the advance role took it.
    expect(ch.timingCorrections).toHaveLength(2);
  });
});

describe("resolveChannels — wastegate duty cycle", () => {
  it("resolves the common WGDC namings", () => {
    for (const label of ["WGDC", "Wastegate Duty", "Boost Control Duty", "WG Position"]) {
      expect(resolve([label]).wgdc?.label, label).toBe(label);
    }
  });

  it("does not let the boost catch-all swallow a duty-cycle channel", () => {
    const ch = resolve(["Boost Control Duty"]);
    expect(ch.wgdc?.label).toBe("Boost Control Duty");
    expect(ch.boostActual).toBeNull();
  });

  it("still prefers the real pressure trace for boostActual", () => {
    const ch = resolve(["Boost Actual", "Boost Target", "WGDC"]);
    expect(ch.boostActual?.label).toBe("Boost Actual");
    expect(ch.boostTarget?.label).toBe("Boost Target");
    expect(ch.wgdc?.label).toBe("WGDC");
  });

  it("leaves both new roles null when the log has neither", () => {
    const ch = resolve(["RPM", "Boost Actual", "IAT"]);
    expect(ch.ignitionTiming).toBeNull();
    expect(ch.wgdc).toBeNull();
  });
});
