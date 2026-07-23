import { describe, expect, it } from "vitest";
import { parseLogFilename } from "./log-filename";

describe("parseLogFilename", () => {
  it("parses the dashed MGflasher naming (yyyy-mm-dd_hh_mm_ss)", () => {
    const p = parseLogFilename("2026-07-20_22_37_14_Stage1_100RON_2.1_CS102258_SM9977.csv");
    expect(p.recordedAt?.toISOString()).toBe("2026-07-20T22:37:14.000Z");
    expect(p.stage).toBe("Stage 1");
    expect(p.octane).toBe("100 RON");
  });

  it("parses the compact date variant with a hash prefix (yyyymmdd_hh_mm_ss)", () => {
    const p = parseLogFilename("040df941-20260712_17_23_23_Stage1_100RON_2.1_CS102258.csv");
    expect(p.recordedAt?.toISOString()).toBe("2026-07-12T17:23:23.000Z");
    expect(p.octane).toBe("100 RON");
  });

  it("recognises an ethanol fuel tag", () => {
    expect(parseLogFilename("2026-01-02_08_00_00_Stage2_E85_run.csv").octane).toBe("E85");
    expect(parseLogFilename("2026-01-02_08_00_00_Stage2_E85_run.csv").stage).toBe("Stage 2");
  });

  it("returns nulls for a name without a timestamp", () => {
    const p = parseLogFilename("Beispiel-Log.csv");
    expect(p.recordedAt).toBeNull();
    expect(p.stage).toBeNull();
    expect(p.octane).toBeNull();
  });

  it("rejects an out-of-range timestamp", () => {
    expect(parseLogFilename("2026-13-40_25_99_99_x.csv").recordedAt).toBeNull();
  });
});
