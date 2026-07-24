import { describe, expect, it } from "vitest";
import { resolveChannels } from "./channels";
import { alignLog, axisLabel, axisValueAt, elapsedSeconds } from "./log-align";
import { makeLog, verifiedPullColumns, type ColumnSpec } from "./test-helpers";

// SYNTHETIC fixtures only.

/** 10 Hz time axis for an n-sample log, so elapsed seconds are meaningful. */
function seconds(n: number, start = 0): number[] {
  return Array.from({ length: n }, (_, i) => +(start + i * 0.1).toFixed(3));
}

/** A pull whose WOT phase starts at `leadIn` (pedal below WOT before that). */
function pullWithLeadIn(leadIn: number, n = 60): ColumnSpec[] {
  const cols = verifiedPullColumns();
  const pedal = Array.from({ length: n }, (_, i) => (i < leadIn ? 20 : 100));
  const p = cols.find((c) => c.label === "Pedal")!;
  p.values = pedal;
  return cols;
}

describe("alignLog — WOT anchor detection", () => {
  it("anchors t=0 at the first ≥99% pedal sample", () => {
    const log = makeLog(pullWithLeadIn(12), seconds(60));
    const align = alignLog(log);
    expect(align.startIndex).toBe(12);
    expect(align.offset).toBeCloseTo(1.2, 3);
    expect(align.pedalDriven).toBe(true);
  });

  it("reports the anchor independently of where the recording starts", () => {
    // Same pull, recording started 30 s later — the anchor must track it.
    const cols = pullWithLeadIn(12);
    const early = alignLog(makeLog(cols, seconds(60, 0)));
    const late = alignLog(makeLog(cols, seconds(60, 30)));
    expect(early.startIndex).toBe(late.startIndex);
    expect(late.offset - early.offset).toBeCloseTo(30, 3);
  });

  it("captures the RPM at the anchor sample", () => {
    const log = makeLog(pullWithLeadIn(12), seconds(60));
    // verifiedPullColumns sweeps 1000 → 7000 RPM across 60 samples.
    expect(alignLog(log).startRpm).toBe(1000 + Math.round((12 / 59) * 6000));
  });

  it("falls back to the RPM sweep when no pedal channel exists", () => {
    const cols = verifiedPullColumns().filter((c) => c.label !== "Pedal");
    const align = alignLog(makeLog(cols, seconds(60)));
    expect(align.pedalDriven).toBe(false);
    // The RPM fallback frames the sweep from its low point to peak RPM.
    expect(align.startIndex).toBe(0);
    expect(align.endIndex).toBe(59);
  });

  it("does not throw on an empty log", () => {
    const empty = makeLog([]);
    const align = alignLog(empty);
    expect(align.startIndex).toBe(0);
    expect(align.offset).toBe(0);
  });
});

describe("axisValueAt — shared X placement", () => {
  const log = makeLog(pullWithLeadIn(12), seconds(60));
  const ch = resolveChannels(log);
  const align = alignLog(log, ch);

  it("shifts the time axis so the anchor sample lands on exactly 0", () => {
    const x = axisValueAt(log, ch, align, "time", "wot");
    expect(x(12)).toBeCloseTo(0, 6);
    expect(x(13)).toBeCloseTo(0.1, 6);
  });

  it("keeps pre-pull samples as negative time rather than clipping them", () => {
    const x = axisValueAt(log, ch, align, "time", "wot");
    expect(x(0)).toBeCloseTo(-1.2, 6);
  });

  it("leaves the axis untouched in raw mode", () => {
    const x = axisValueAt(log, ch, align, "time", "raw");
    expect(x(12)).toBeCloseTo(1.2, 6);
    expect(x(0)).toBeCloseTo(0, 6);
  });

  it("returns engine speed on the RPM axis, ignoring the align mode", () => {
    const wot = axisValueAt(log, ch, align, "rpm", "wot");
    const raw = axisValueAt(log, ch, align, "rpm", "raw");
    expect(wot(30)).toBe(ch.rpm!.values[30]);
    expect(wot(30)).toBe(raw(30));
  });

  it("yields null on the RPM axis when the log has no RPM channel", () => {
    const noRpm = makeLog(verifiedPullColumns().filter((c) => c.label !== "RPM"), seconds(60));
    const c = resolveChannels(noRpm);
    const x = axisValueAt(noRpm, c, alignLog(noRpm, c), "rpm", "wot");
    expect(x(10)).toBeNull();
  });
});

describe("axisLabel / elapsedSeconds", () => {
  it("labels the aligned time axis distinctly from the raw one", () => {
    const log = makeLog(pullWithLeadIn(12), seconds(60));
    expect(axisLabel(log, "time", "wot")).toContain("WOT");
    expect(axisLabel(log, "time", "raw")).not.toContain("WOT");
    expect(axisLabel(log, "rpm", "wot")).toBe("RPM");
  });

  it("returns elapsed seconds relative to the anchor", () => {
    const log = makeLog(pullWithLeadIn(12), seconds(60));
    const align = alignLog(log);
    expect(elapsedSeconds(log, align, 22)).toBeCloseTo(1.0, 6);
  });

  it("returns null on a synthetic (index-based) time axis", () => {
    const log = makeLog(pullWithLeadIn(12)); // no time array → timeUnit "#"
    expect(elapsedSeconds(log, alignLog(log), 22)).toBeNull();
  });
});
