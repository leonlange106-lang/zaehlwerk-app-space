import { describe, expect, it } from "vitest";
import { remediationFor, REMEDIATION_DISCLAIMER } from "./remediation";

// These suggestions are read by someone about to spend money on their car, so
// the properties worth testing are not "does a string come back" but: is the
// cheap option first, does a per-cylinder alert still find its advice, and does
// nothing here pretend to be a diagnosis.

describe("remediationFor", () => {
  it("answers for every alert the engine can raise", () => {
    // The ids the evaluation actually emits. A new alert without advice is not
    // a failure — `null` is a valid answer — but these are the ones that were
    // deliberately covered, and losing one silently would be.
    for (const id of [
      "knock",
      "knock-total",
      "egt-limit",
      "lambda-lean",
      "hpfp-drop",
      "hpfp-low",
      "boost-deviation",
      "boost-limit",
      "iat-limit",
    ]) {
      expect(remediationFor(id), `no advice for ${id}`).not.toBeNull();
    }
  });

  it("resolves a per-cylinder knock alert to the knock advice", () => {
    // The engine emits `knock-1`, `knock-2`, … — the suffix is where it was
    // seen, not a different mechanism. Without the prefix fallback the alerts
    // that matter most would get nothing.
    expect(remediationFor("knock-1")).toEqual(remediationFor("knock"));
    expect(remediationFor("knock-6")).toEqual(remediationFor("knock"));
  });

  it("keeps knock-total distinct from single-cylinder knock", () => {
    // Several cylinders at once points at a shared cause, not at one coil.
    expect(remediationFor("knock-total")).not.toEqual(remediationFor("knock"));
  });

  it("routes the trim alerts to the right half", () => {
    expect(remediationFor("trim-stft")).toEqual(remediationFor("stft"));
    expect(remediationFor("trim-ltft")).toEqual(remediationFor("ltft"));
  });

  it("returns null rather than inventing advice", () => {
    expect(remediationFor("something-new")).toBeNull();
    expect(remediationFor("")).toBeNull();
  });

  it("puts the cheap, likely step first", () => {
    // The ordering IS the content: sending someone to buy turbos over what a
    // tank of better fuel would settle is the failure mode.
    expect(remediationFor("knock")!.steps[0]).toMatch(/Oktanzahl/);
    expect(remediationFor("boost-deviation")!.steps[0]).toMatch(/Undichtigkeit/);
    expect(remediationFor("hpfp-drop")!.steps[0]).toMatch(/Kraftstofffilter/);
  });

  it("mentions the expensive part last, if at all", () => {
    const boost = remediationFor("boost-deviation")!;
    expect(boost.steps[boost.steps.length - 1]).toMatch(/Turbolader/);
    const hpfp = remediationFor("hpfp-drop")!;
    expect(hpfp.steps.findIndex((s) => /Hochdruckpumpe/.test(s))).toBeGreaterThan(0);
  });

  it("suggests, never instructs", () => {
    // These are interventions on someone's car. Every step has to read as
    // "prüfen"/"erwägen", not as an order.
    const imperative = /^(Tausche|Wechsle|Ersetze|Baue|Kaufe)\b/;
    for (const id of ["knock", "egt-limit", "hpfp-drop", "boost-limit", "iat-limit"]) {
      for (const step of remediationFor(id)!.steps) {
        expect(step, `imperative in ${id}: ${step}`).not.toMatch(imperative);
      }
    }
  });

  it("explains why, not just what", () => {
    for (const id of ["knock", "egt-limit", "lambda-lean"]) {
      expect(remediationFor(id)!.rationale.length, `${id} needs a rationale`).toBeGreaterThan(40);
    }
  });

  it("carries a disclaimer that says this is not a diagnosis", () => {
    expect(REMEDIATION_DISCLAIMER).toMatch(/keine Diagnose/);
  });
});
