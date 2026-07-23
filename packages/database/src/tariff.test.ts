import { describe, expect, it } from "vitest";
import { calculateTariffCost, pickTariffForDate, type TariffInput } from "./tariff";
import { GAS_KWH_FACTOR, gasM3ToKwh } from "./gas";

const tarif = (over: Partial<TariffInput> = {}): TariffInput => ({
  gueltigAb: "2024-01-01",
  gueltigBis: null,
  arbeitspreisCtNetto: 30, // 30 ct/kWh net
  grundpreisJahrNetto: 100, // 100 €/yr net
  mwstProzent: 19,
  ...over,
});

describe("calculateTariffCost", () => {
  it("applies VAT to both the working and base price (original xlsm formula)", () => {
    // 1000 kWh: work = 30ct × 1.19 × 1000 / 100 = 357 €; base = 100 × 1.19 = 119 €.
    const cost = calculateTariffCost(tarif(), 1000, 365);
    expect(cost).toBeCloseTo(357 + 119, 6);
  });

  it("prorates the annual base price by interval length", () => {
    const cost = calculateTariffCost(tarif(), 0, 365 / 2);
    expect(cost).toBeCloseTo((100 * 1.19) / 2, 6);
  });

  it("charges no base price for a zero/negative day span", () => {
    const cost = calculateTariffCost(tarif(), 100, 0);
    // Only working cost: 30 × 1.19 × 100 / 100 = 35.7
    expect(cost).toBeCloseTo(35.7, 6);
  });

  it("handles 0% VAT as a pass-through", () => {
    const cost = calculateTariffCost(tarif({ mwstProzent: 0, grundpreisJahrNetto: 0 }), 100, 365);
    expect(cost).toBeCloseTo(30, 6);
  });
});

describe("pickTariffForDate", () => {
  const tarife: TariffInput[] = [
    tarif({ gueltigAb: "2023-01-01", gueltigBis: "2023-12-31" }),
    tarif({ gueltigAb: "2024-01-01", gueltigBis: null }),
  ];

  it("selects the tariff whose validity window covers the date", () => {
    expect(pickTariffForDate(tarife, new Date("2023-06-01"))?.gueltigAb).toBe("2023-01-01");
    expect(pickTariffForDate(tarife, new Date("2024-06-01"))?.gueltigAb).toBe("2024-01-01");
  });

  it("treats an empty gueltigBis as open-ended into the future", () => {
    expect(pickTariffForDate(tarife, new Date("2030-01-01"))?.gueltigAb).toBe("2024-01-01");
  });

  it("returns null when no tariff covers the date", () => {
    expect(pickTariffForDate(tarife, new Date("2020-01-01"))).toBeNull();
  });
});

describe("gasM3ToKwh", () => {
  it("multiplies by the combined calorific/state factor", () => {
    expect(gasM3ToKwh(100)).toBeCloseTo(100 * GAS_KWH_FACTOR, 6);
    expect(gasM3ToKwh(0)).toBe(0);
  });
});
