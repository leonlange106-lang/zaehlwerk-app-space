import { describe, expect, it } from "vitest";
import {
  describeLimits,
  effectiveLimits,
  isOverridden,
  LIMIT_BOUNDS,
  OVERRIDABLE_LIMITS,
  parseLimitOverrides,
  serializeLimitOverrides,
} from "./limit-overrides";
import { DEFAULT_VEHICLE_SPEC, limitsForSpec } from "./vehicle-spec";
import { evaluationVersionFor } from "./evaluation-version";

describe("parseLimitOverrides", () => {
  it("reads a well-formed patch", () => {
    expect(parseLimitOverrides('{"maxEgt":950}')).toEqual({ maxEgt: 950 });
  });

  it("treats nothing stored as nothing overridden", () => {
    expect(parseLimitOverrides(null)).toEqual({});
    expect(parseLimitOverrides("")).toEqual({});
    expect(parseLimitOverrides("{}")).toEqual({});
  });

  it("survives corrupt JSON", () => {
    // The column is written by an earlier version of this app; a broken value
    // must degrade to "derived" rather than reach the evaluation engine.
    expect(parseLimitOverrides("{not json")).toEqual({});
    expect(parseLimitOverrides("[1,2,3]")).toEqual({});
    expect(parseLimitOverrides("null")).toEqual({});
  });

  it("drops keys that are not overridable", () => {
    // Including ones that exist on SpecLimits but are not offered — e.g.
    // `wotThreshold` defines what a pull IS, not how strict it is judged.
    expect(parseLimitOverrides('{"maxEgt":950,"wotThreshold":50,"nonsense":1}')).toEqual({
      maxEgt: 950,
    });
  });

  it("drops values that are not finite numbers", () => {
    expect(parseLimitOverrides('{"maxEgt":"950"}')).toEqual({});
    expect(parseLimitOverrides('{"maxEgt":null}')).toEqual({});
  });

  it("drops values outside the plausible range", () => {
    // The reason bounds are enforced here and not only in the form: a typo of
    // one order of magnitude does not show up as a wrong number on a screen, it
    // silently reclassifies every log evaluated afterwards.
    expect(parseLimitOverrides('{"maxEgt":95000}')).toEqual({});
    expect(parseLimitOverrides('{"maxEgt":5}')).toEqual({});
    expect(parseLimitOverrides('{"maxEgt":950}')).toEqual({ maxEgt: 950 });
  });

  it("accepts the negative knock correction the sign convention requires", () => {
    // It is a timing RETARD: "more knock" means further below zero, so a
    // positive value here would invert the alert.
    expect(parseLimitOverrides('{"knockCorrection":-6}')).toEqual({ knockCorrection: -6 });
    expect(parseLimitOverrides('{"knockCorrection":6}')).toEqual({});
  });

  it("accepts every bound's own endpoints", () => {
    for (const key of OVERRIDABLE_LIMITS) {
      const { min, max } = LIMIT_BOUNDS[key];
      expect(parseLimitOverrides(JSON.stringify({ [key]: min })), `${key} min`).toEqual({
        [key]: min,
      });
      expect(parseLimitOverrides(JSON.stringify({ [key]: max })), `${key} max`).toEqual({
        [key]: max,
      });
    }
  });
});

describe("serializeLimitOverrides", () => {
  it("round-trips a valid patch", () => {
    expect(parseLimitOverrides(serializeLimitOverrides({ maxEgt: 950 }))).toEqual({ maxEgt: 950 });
  });

  it("refuses to persist a value it would not read back", () => {
    // Otherwise the database holds something the parser silently ignores, and
    // the form shows a manual value the engine never uses.
    expect(serializeLimitOverrides({ maxEgt: 99999 })).toBe("{}");
  });
});

describe("effectiveLimits", () => {
  it("is the derived table when nothing is overridden", () => {
    expect(effectiveLimits(DEFAULT_VEHICLE_SPEC, {})).toEqual(limitsForSpec(DEFAULT_VEHICLE_SPEC));
  });

  it("replaces only what was overridden", () => {
    const derived = limitsForSpec(DEFAULT_VEHICLE_SPEC);
    const merged = effectiveLimits(DEFAULT_VEHICLE_SPEC, { maxEgt: 950 });
    expect(merged.maxEgt).toBe(950);
    expect(merged.maxBoost).toBe(derived.maxBoost);
    expect(merged.engineLabel).toBe(derived.engineLabel);
  });

  it("keeps following the maintained tables for untouched keys", () => {
    // The reason only a sparse patch is stored: a full copy would freeze the
    // vehicle at the day it was created, and every later correction to the
    // threshold tables would stop reaching it.
    const stock = effectiveLimits({ ...DEFAULT_VEHICLE_SPEC, catType: "oem" }, { maxBoost: 1.5 });
    const catless = effectiveLimits(
      { ...DEFAULT_VEHICLE_SPEC, catType: "catless" },
      { maxBoost: 1.5 },
    );
    expect(stock.maxBoost).toBe(catless.maxBoost); // overridden — identical
    expect(stock.maxEgt).not.toBe(catless.maxEgt); // derived — still differs
  });
});

describe("isOverridden / describeLimits", () => {
  it("marks exactly the manual rows", () => {
    const overrides = { maxEgt: 950 };
    expect(isOverridden(overrides, "maxEgt")).toBe(true);
    expect(isOverridden(overrides, "maxBoost")).toBe(false);
  });

  it("offers the derived value alongside the manual one", () => {
    // § 6.3 wants the derived value struck through beside the manual one — the
    // UI cannot draw that without both numbers.
    const rows = describeLimits(DEFAULT_VEHICLE_SPEC, { maxEgt: 950 });
    const egt = rows.find((row) => row.key === "maxEgt")!;
    expect(egt.value).toBe(950);
    expect(egt.derived).toBe(limitsForSpec(DEFAULT_VEHICLE_SPEC).maxEgt);
    expect(egt.manual).toBe(true);
    expect(egt.unit).toBe("°C");
  });

  it("describes every overridable limit, with a label for each", () => {
    const rows = describeLimits(DEFAULT_VEHICLE_SPEC, {});
    expect(rows).toHaveLength(OVERRIDABLE_LIMITS.length);
    for (const row of rows) {
      expect(row.label, `${row.key} needs a label`).toBeTruthy();
      expect(row.manual).toBe(false);
      expect(row.value).toBe(row.derived);
    }
  });
});

describe("the evaluation cache sees custom limits", () => {
  it("changes when an override changes", () => {
    // The gap this closes: the automatic hash covers the threshold TABLES, so a
    // user-defined limit was invisible to it. Raising your own EGT ceiling
    // changed what the engine would say while every stored log kept its badge.
    const base = evaluationVersionFor(effectiveLimits(DEFAULT_VEHICLE_SPEC, {}));
    const raised = evaluationVersionFor(effectiveLimits(DEFAULT_VEHICLE_SPEC, { maxEgt: 950 }));
    expect(raised).not.toBe(base);
  });

  it("is stable for the same limits", () => {
    // Otherwise every read re-evaluates every log and the cache is decoration.
    expect(evaluationVersionFor(effectiveLimits(DEFAULT_VEHICLE_SPEC, { maxEgt: 950 }))).toBe(
      evaluationVersionFor(effectiveLimits(DEFAULT_VEHICLE_SPEC, { maxEgt: 950 })),
    );
  });

  it("is unaffected by key order", () => {
    expect(evaluationVersionFor({ a: 1, b: 2 })).toBe(evaluationVersionFor({ b: 2, a: 1 }));
  });

  it("differs between two vehicles with different specs", () => {
    expect(
      evaluationVersionFor(effectiveLimits({ ...DEFAULT_VEHICLE_SPEC, catType: "catless" }, {})),
    ).not.toBe(evaluationVersionFor(effectiveLimits(DEFAULT_VEHICLE_SPEC, {})));
  });
});
