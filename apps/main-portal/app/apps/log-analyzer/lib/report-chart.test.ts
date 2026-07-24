import { describe, expect, it } from "vitest";
import {
  buildPanelGeometry,
  niceStep,
  niceTicks,
  pointsAttr,
  tickDigits,
  type ChartPadding,
} from "./report-chart";
import type { ReportChartPanel, ReportPanelSeries } from "./report-generator";

const PADDING: ChartPadding = { left: 40, right: 40, top: 10, bottom: 20 };

function series(overrides: Partial<ReportPanelSeries> = {}): ReportPanelSeries {
  return {
    key: "s",
    label: "Serie",
    color: "#f97316",
    dashed: false,
    axis: "left",
    values: [0, 5, 10],
    ...overrides,
  };
}

function panel(overrides: Partial<ReportChartPanel> = {}): ReportChartPanel {
  return {
    id: "p",
    title: "Panel",
    leftUnit: "bar",
    rightUnit: null,
    xLabel: "Zeit (s)",
    x: [0, 1, 2],
    series: [series()],
    markers: [],
    band: null,
    ...overrides,
  };
}

describe("niceStep", () => {
  it("rounds up to a 1/2/5 × 10ⁿ step", () => {
    expect(niceStep(0.11)).toBe(0.2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(6)).toBe(10);
    expect(niceStep(1200)).toBe(2000);
  });

  it("degrades safely on a non-positive or non-finite step", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe("niceTicks", () => {
  it("spans the domain with round values", () => {
    const { ticks, lo, hi } = niceTicks(0, 7000, 4);
    expect(lo).toBe(0);
    expect(hi).toBe(8000);
    expect(ticks).toEqual([0, 2000, 4000, 6000, 8000]);
  });

  it("brackets the data even when the domain does not start at zero", () => {
    const { lo, hi } = niceTicks(-3.2, 1.4);
    expect(lo).toBeLessThanOrEqual(-3.2);
    expect(hi).toBeGreaterThanOrEqual(1.4);
  });

  it("widens a degenerate domain instead of collapsing it", () => {
    const { lo, hi } = niceTicks(5, 5);
    expect(hi).toBeGreaterThan(lo);
  });

  it("keeps the final tick despite floating-point accumulation", () => {
    const { ticks, hi } = niceTicks(0, 1);
    expect(ticks[ticks.length - 1]).toBeCloseTo(hi, 10);
  });
});

describe("tickDigits", () => {
  it("adds decimals only for sub-unit steps", () => {
    expect(tickDigits(2000)).toBe(0);
    expect(tickDigits(2)).toBe(0);
    expect(tickDigits(0.5)).toBe(1);
    expect(tickDigits(0.05)).toBe(2);
  });
});

describe("buildPanelGeometry", () => {
  it("projects the domain onto the plot rectangle", () => {
    const geometry = buildPanelGeometry(panel(), 400, 120, PADDING);
    expect(geometry).not.toBeNull();
    expect(geometry?.plot).toEqual({ x: 40, y: 10, width: 320, height: 90 });
    const points = geometry?.lines[0].segments[0] ?? [];
    // x runs 0…2 over a 0…2 domain, so the trace spans the full plot width.
    expect(points[0].x).toBeCloseTo(40, 5);
    expect(points[points.length - 1].x).toBeCloseTo(360, 5);
  });

  it("inverts the y axis so the maximum sits at the top", () => {
    const geometry = buildPanelGeometry(panel(), 400, 120, PADDING);
    const points = geometry?.lines[0].segments[0] ?? [];
    expect(points[0].y).toBeGreaterThan(points[2].y);
  });

  it("breaks a trace into segments across gaps", () => {
    const geometry = buildPanelGeometry(
      panel({
        x: [0, 1, 2, 3, 4],
        series: [series({ values: [1, 2, null, 4, 5] })],
      }),
      400,
      120,
      PADDING,
    );
    expect(geometry?.lines[0].segments).toHaveLength(2);
    expect(geometry?.lines[0].segments[0]).toHaveLength(2);
    expect(geometry?.lines[0].segments[1]).toHaveLength(2);
  });

  it("keeps an isolated sample as a one-point segment", () => {
    const geometry = buildPanelGeometry(
      panel({ x: [0, 1, 2], series: [series({ values: [null, 7, null] })] }),
      400,
      120,
      PADDING,
    );
    expect(geometry?.lines[0].segments).toEqual([[expect.objectContaining({ y: expect.any(Number) })]]);
  });

  it("scales left and right axis series independently", () => {
    const geometry = buildPanelGeometry(
      panel({
        rightUnit: "Nm",
        series: [
          series({ key: "l", values: [0, 100, 200] }),
          series({ key: "r", axis: "right", values: [0, 2, 4] }),
        ],
      }),
      400,
      120,
      PADDING,
    );
    // Both peak at the top of the plot despite domains two orders apart.
    const leftTop = geometry?.lines[0].segments[0][2].y ?? 0;
    const rightTop = geometry?.lines[1].segments[0][2].y ?? 0;
    expect(leftTop).toBeCloseTo(rightTop, 5);
    expect(geometry?.leftTicks.length).toBeGreaterThan(1);
    expect(geometry?.rightTicks.length).toBeGreaterThan(1);
  });

  it("clips the pull band to the plot area", () => {
    const geometry = buildPanelGeometry(
      panel({ band: { start: -10, end: 1 } }),
      400,
      120,
      PADDING,
    );
    expect(geometry?.band?.x).toBe(40);
    expect((geometry?.band?.width ?? 0) + 40).toBeLessThanOrEqual(360);
  });

  it("drops a band that lies outside the domain", () => {
    const geometry = buildPanelGeometry(panel({ band: { start: -9, end: -8 } }), 400, 120, PADDING);
    expect(geometry?.band).toBeNull();
  });

  it("keeps only markers that fall inside the plot", () => {
    const geometry = buildPanelGeometry(
      panel({
        markers: [
          { x: 1, label: "drin", severity: "warning" },
          { x: 99, label: "draussen", severity: "critical" },
        ],
      }),
      400,
      120,
      PADDING,
    );
    expect(geometry?.markers.map((m) => m.label)).toEqual(["drin"]);
  });

  it("returns null when there is nothing to plot", () => {
    expect(buildPanelGeometry(panel({ x: [] }), 400, 120, PADDING)).toBeNull();
    expect(
      buildPanelGeometry(panel({ series: [series({ values: [null, null, null] })] }), 400, 120, PADDING),
    ).toBeNull();
  });
});

describe("pointsAttr", () => {
  it("serialises a segment to the shared SVG/react-pdf points syntax", () => {
    expect(
      pointsAttr([
        { x: 1, y: 2 },
        { x: 3.456, y: 4.5 },
      ]),
    ).toBe("1.00,2.00 3.46,4.50");
  });
});
