import { describe, expect, it } from "vitest";
import { evaluateLogPull, healthFromAlerts } from "./evaluate-log-pull";
import { DEFAULT_VEHICLE_SPEC } from "./vehicle-spec";
import { estimateDyno } from "./dyno-engine";
import { DEFAULT_DYNO_PROFILE } from "./dyno-spec";
import { makeLog, verifiedPullColumns, type ColumnSpec } from "./test-helpers";
import {
  buildDynoPanel,
  buildDynoSummary,
  buildReportPayload,
  buildWotPanels,
  detectTunerPlatform,
  fmtAxis,
  fmtNum,
  maxTimingPull,
  peakBoostBar,
  reportFilename,
  strideIndices,
  type ReportInput,
} from "./report-generator";
import { resolveChannels } from "./channels";

const GENERATED_AT = "2026-07-24T10:30:00.000Z";

/** A verified pull with time in seconds and the channels the report cares about. */
function pullLog(overrides: ColumnSpec[] = []) {
  const columns = verifiedPullColumns();
  const n = columns[0].values.length;
  const time = Array.from({ length: n }, (_, i) => i * 0.1);
  const extra: ColumnSpec[] = [
    { label: "IAT", unit: "°C", values: new Array(n).fill(38) },
    { label: "Ignition Timing", unit: "°", values: new Array(n).fill(9) },
    { label: "Lambda", unit: "lambda", values: new Array(n).fill(0.82) },
    ...overrides,
  ];
  return makeLog([...columns, ...extra], time);
}

function baseInput(partial: Partial<ReportInput> = {}): ReportInput {
  const log = partial.log ?? pullLog();
  const evaluation = evaluateLogPull(log, DEFAULT_VEHICLE_SPEC);
  return {
    name: "2026-07-24_wot_pull.csv",
    log,
    evaluation,
    spec: DEFAULT_VEHICLE_SPEC,
    health: healthFromAlerts(evaluation.alerts),
    generatedAt: GENERATED_AT,
    ...partial,
  };
}

describe("fmtNum / fmtAxis", () => {
  it("formats German decimals and thousands groups without Intl", () => {
    expect(fmtNum(1234.5, 1)).toBe("1.234,5");
    expect(fmtNum(7000)).toBe("7.000");
    expect(fmtNum(0.987, 2)).toBe("0,99");
    expect(fmtNum(-1234.5, 1)).toBe("-1.234,5");
  });

  it("labels the axis by the log's time unit", () => {
    expect(fmtAxis(12.34, "s")).toBe("12,3 s");
    expect(fmtAxis(310, "#")).toBe("#310");
  });
});

describe("detectTunerPlatform", () => {
  it("prefers the import source URL", () => {
    const log = makeLog([{ label: "RPM", values: [1000, 2000] }]);
    expect(detectTunerPlatform(log, "https://logs.mgflasher.com/log/abc")).toBe("mgflasher");
  });

  it("reads the software metadata header", () => {
    const log = makeLog([{ label: "RPM", values: [1000, 2000] }]);
    log.meta.software = "MHD Flasher F+G Series 4.10";
    expect(detectTunerPlatform(log)).toBe("mhd");
    log.meta.software = "bootmod3 v3.2";
    expect(detectTunerPlatform(log)).toBe("bootmod3");
  });

  it("falls back to characteristic channel naming", () => {
    const bm3 = makeLog([{ label: "bm3_boost_actual", values: [1, 2] }]);
    expect(detectTunerPlatform(bm3)).toBe("bootmod3");
    const mgf = makeLog([{ label: "Fuel: Lambda Actual", values: [1, 2] }]);
    expect(detectTunerPlatform(mgf)).toBe("mgflasher");
    const mhd = makeLog([{ label: "AFR", values: [14, 12] }]);
    expect(detectTunerPlatform(mhd)).toBe("mhd");
  });

  it("returns unknown when nothing identifies the tool", () => {
    expect(detectTunerPlatform(makeLog([{ label: "RPM", values: [1, 2] }]))).toBe("unknown");
  });
});

describe("channel extraction", () => {
  it("converts peak boost to bar regardless of the logged unit", () => {
    const log = pullLog();
    const ch = resolveChannels(log);
    const evaluation = evaluateLogPull(log, DEFAULT_VEHICLE_SPEC);
    const [lo, hi] = evaluation.window;
    const bar = peakBoostBar(ch, lo, hi);
    // The helper logs psi; 19.5 psi ≈ 1.34 bar.
    expect(bar).not.toBeNull();
    expect(bar as number).toBeGreaterThan(1.2);
    expect(bar as number).toBeLessThan(1.45);
  });

  it("reports the worst timing correction across all cylinders", () => {
    const n = 60;
    const log = pullLog([
      { label: "Ignition Correction Cyl 2", unit: "°", values: new Array(n).fill(-1.5) },
      { label: "Ignition Correction Cyl 3", unit: "°", values: new Array(n).fill(-4.25) },
    ]);
    const ch = resolveChannels(log);
    expect(maxTimingPull(ch, 0, n - 1)).toBe(-4.25);
  });

  it("clamps a never-pulled correction channel to 0 and returns null without one", () => {
    const withCorrection = resolveChannels(pullLog());
    expect(maxTimingPull(withCorrection, 0, 59)).toBe(0);

    const bare = resolveChannels(makeLog([{ label: "RPM", values: [1000, 2000] }]));
    expect(maxTimingPull(bare, 0, 1)).toBeNull();
  });
});

describe("strideIndices", () => {
  it("returns every index when the span fits the budget", () => {
    expect(strideIndices(2, 6, 240)).toEqual([2, 3, 4, 5, 6]);
  });

  it("decimates a long span but always keeps the last sample", () => {
    const indices = strideIndices(0, 999, 100);
    expect(indices.length).toBeLessThanOrEqual(101);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(999);
  });

  it("is empty for an inverted range", () => {
    expect(strideIndices(5, 4)).toEqual([]);
  });
});

describe("buildWotPanels", () => {
  it("emits one panel per available channel group", () => {
    const log = pullLog();
    const evaluation = evaluateLogPull(log, DEFAULT_VEHICLE_SPEC);
    const panels = buildWotPanels(log, evaluation, resolveChannels(log));
    expect(panels.map((p) => p.id)).toEqual(["rpm", "boost", "timing", "lambda"]);
  });

  it("plots boost target and actual on one bar scale", () => {
    const log = pullLog();
    const evaluation = evaluateLogPull(log, DEFAULT_VEHICLE_SPEC);
    const boost = buildWotPanels(log, evaluation, resolveChannels(log)).find((p) => p.id === "boost");
    expect(boost?.leftUnit).toBe("bar");
    expect(boost?.series.map((s) => s.axis)).toEqual(["left", "left"]);
    expect(boost?.series[1].dashed).toBe(true);
    // psi values must have been converted, so nothing sits near 20.
    const peak = Math.max(...(boost?.series[0].values.filter((v): v is number => v !== null) ?? []));
    expect(peak).toBeLessThan(2);
  });

  it("puts corrections on the right axis when absolute timing is also present", () => {
    const log = pullLog();
    const evaluation = evaluateLogPull(log, DEFAULT_VEHICLE_SPEC);
    const timing = buildWotPanels(log, evaluation, resolveChannels(log)).find((p) => p.id === "timing");
    expect(timing?.series[0].axis).toBe("left");
    expect(timing?.series.slice(1).every((s) => s.axis === "right")).toBe(true);
    expect(timing?.rightUnit).toBe("° Korr.");
  });

  it("normalises an AFR-scaled lambda channel onto the λ scale", () => {
    const n = 60;
    const log = pullLog([{ label: "AFR Bank 1", unit: "afr", values: new Array(n).fill(12.5) }]);
    const evaluation = evaluateLogPull(log, DEFAULT_VEHICLE_SPEC);
    const lambda = buildWotPanels(log, evaluation, resolveChannels(log)).find((p) => p.id === "lambda");
    const first = lambda?.series[0].values[0];
    expect(first).not.toBeNull();
    expect(first as number).toBeLessThan(1.2);
  });

  it("returns no panels for a degenerate window", () => {
    const log = makeLog([{ label: "RPM", values: [1000] }]);
    const evaluation = evaluateLogPull(log, DEFAULT_VEHICLE_SPEC);
    expect(buildWotPanels(log, evaluation, resolveChannels(log))).toEqual([]);
  });
});

describe("dyno sections", () => {
  const log = pullLog([
    { label: "MAF", unit: "g/s", values: Array.from({ length: 60 }, (_, i) => 20 + i * 6) },
  ]);
  const estimate = estimateDyno(log, DEFAULT_DYNO_PROFILE, { correction: "sae" });

  it("builds a dual-axis power/torque panel", () => {
    const panel = buildDynoPanel(estimate, "crank");
    expect(panel).not.toBeNull();
    expect(panel?.series.map((s) => s.axis)).toEqual(["left", "right"]);
    expect(panel?.leftUnit).toBe("PS");
    expect(panel?.rightUnit).toBe("Nm");
    expect(panel?.xLabel).toContain("Drehzahl");
  });

  it("summarises peaks with the applied correction factor", () => {
    const summary = buildDynoSummary(estimate, "crank", "sae");
    expect(summary).not.toBeNull();
    expect(summary?.correction).toBe("SAE J1349");
    expect(summary?.correctionFactor).toBeGreaterThan(0.8);
    expect(summary?.peakPs).toBeGreaterThan(0);
    expect(summary?.peakNm).toBeGreaterThan(0);
    expect(summary?.output).toBe("Kurbelwelle");
  });

  it("reports no correction factor when uncorrected", () => {
    expect(buildDynoSummary(estimate, "wheel", "none")?.correctionFactor).toBeNull();
  });

  it("returns null when no curve could be estimated", () => {
    const bare = estimateDyno(makeLog([{ label: "Boost", values: [1, 2] }]), DEFAULT_DYNO_PROFILE);
    expect(buildDynoPanel(bare, "crank")).toBeNull();
    expect(buildDynoSummary(bare, "crank", "none")).toBeNull();
  });
});

describe("buildReportPayload", () => {
  it("assembles header metadata, verdict and the required key metrics", () => {
    const payload = buildReportPayload(baseInput({ contentHash: "a".repeat(64), source: "upload" }));
    expect(payload.title).toBe("2026-07-24_wot_pull.csv");
    expect(payload.generatedAt).toBe(GENERATED_AT);
    expect(payload.meta.contentHash).toBe("a".repeat(64));
    expect(payload.verdict.statusLabel).toBe("VERIFIED");
    expect(payload.verdict.healthLabel).toBe("Hardware-sicher");
    expect(payload.verdict.metrics.map((m) => m.label)).toEqual([
      "Peak Boost",
      "Max. IAT",
      "Max. Timing Pull",
      "Max. EGT",
    ]);
    expect(payload.verdict.metrics[1].value).toBe("38 °C");
  });

  it("maps the three pull statuses onto the report's badge vocabulary", () => {
    const verified = buildReportPayload(baseInput());
    expect(verified.verdict.statusLabel).toBe("VERIFIED");

    // A pull that never reaches full throttle is not a valid pull.
    const lazy = makeLog(verifiedPullColumns({ pedal: new Array(60).fill(30) }));
    expect(buildReportPayload(baseInput({ log: lazy })).verdict.statusLabel).toBe("UNVERIFIED");
  });

  it("renders unavailable metrics as an em dash rather than omitting them", () => {
    const bare = makeLog(verifiedPullColumns());
    const payload = buildReportPayload(baseInput({ log: bare }));
    expect(payload.verdict.metrics.find((m) => m.label === "Max. IAT")?.value).toBe("—");
    expect(payload.verdict.metrics.find((m) => m.label === "Max. EGT")?.value).toBe("—");
  });

  it("honours the section toggles", () => {
    const off = buildReportPayload(
      baseInput({ sections: { wotChart: false, violations: false, fileSummary: false } }),
    );
    expect(off.panels).toEqual([]);
    expect(off.violations).toEqual([]);
    expect(off.fileSummary).toEqual([]);
    expect(off.sections.dynoCurve).toBe(true);

    const on = buildReportPayload(baseInput());
    expect(on.panels.length).toBeGreaterThan(0);
    expect(on.fileSummary.length).toBeGreaterThan(0);
  });

  it("omits the dyno section unless an estimate is supplied", () => {
    expect(buildReportPayload(baseInput()).dyno).toBeNull();
    expect(buildReportPayload(baseInput()).dynoPanel).toBeNull();

    const log = pullLog([
      { label: "MAF", unit: "g/s", values: Array.from({ length: 60 }, (_, i) => 20 + i * 6) },
    ]);
    const withDyno = buildReportPayload(
      baseInput({
        log,
        dyno: {
          estimate: estimateDyno(log, DEFAULT_DYNO_PROFILE),
          output: "crank",
          correction: "none",
        },
      }),
    );
    expect(withDyno.dyno).not.toBeNull();
    expect(withDyno.dynoPanel).not.toBeNull();
  });

  it("drops the dyno section when its toggle is off even with an estimate", () => {
    const log = pullLog([
      { label: "MAF", unit: "g/s", values: Array.from({ length: 60 }, (_, i) => 20 + i * 6) },
    ]);
    const payload = buildReportPayload(
      baseInput({
        log,
        sections: { dynoCurve: false },
        dyno: { estimate: estimateDyno(log, DEFAULT_DYNO_PROFILE), output: "crank", correction: "none" },
      }),
    );
    expect(payload.dyno).toBeNull();
    expect(payload.dynoPanel).toBeNull();
  });

  it("lists every violation with a formatted timestamp", () => {
    // A hard knock event on one cylinder, sustained long enough to be real.
    const n = 60;
    const correction = new Array(n).fill(0);
    for (let i = 30; i < 45; i += 1) correction[i] = -7;
    const log = pullLog([
      { label: "Ignition Correction Cyl 1", unit: "°", values: correction },
    ]);
    const payload = buildReportPayload(baseInput({ log }));
    expect(payload.violations.length).toBeGreaterThan(0);
    const knock = payload.violations.find((v) => v.label.includes("Klopfen"));
    expect(knock?.severity).toBe("critical");
    expect(knock?.at).toMatch(/^\d+,\d s$/);
  });

  it("defaults to the print-optimized light theme", () => {
    expect(buildReportPayload(baseInput()).theme).toBe("light");
    expect(buildReportPayload(baseInput({ theme: "dark" })).theme).toBe("dark");
  });

  it("never throws on an empty log", () => {
    const empty = makeLog([{ label: "RPM", values: [] }]);
    const evaluation = evaluateLogPull(empty, DEFAULT_VEHICLE_SPEC);
    const payload = buildReportPayload(
      baseInput({ log: empty, evaluation, health: healthFromAlerts(evaluation.alerts) }),
    );
    expect(payload.panels).toEqual([]);
    expect(payload.violations).toEqual([]);
    // Every metric degrades to a dash rather than the payload failing to build.
    expect(payload.verdict.metrics.every((m) => m.value === "—" || m.value.length > 0)).toBe(true);
    expect(payload.fileSummary.find((m) => m.label === "Datenzeilen")?.value).toBe("0");
  });
});

describe("reportFilename", () => {
  it("slugifies the log name and stamps the generation date", () => {
    const payload = buildReportPayload(baseInput());
    expect(reportFilename(payload, "pdf")).toBe(
      "zaehlwerk-logbericht_2026-07-24-wot-pull_2026-07-24.pdf",
    );
    expect(reportFilename(payload, "png")).toMatch(/\.png$/);
  });

  it("falls back to a generic base for an unslugifiable name", () => {
    const payload = buildReportPayload(baseInput({ name: "###.csv" }));
    expect(reportFilename(payload, "pdf")).toBe("zaehlwerk-logbericht_log_2026-07-24.pdf");
  });
});
