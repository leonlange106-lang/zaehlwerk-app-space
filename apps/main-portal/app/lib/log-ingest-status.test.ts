import { describe, expect, it } from "vitest";
import { ingestStatusFromPull } from "./log-ingest-status";

describe("ingestStatusFromPull", () => {
  it("maps the internal pull verdict to the external ingestion vocabulary", () => {
    expect(ingestStatusFromPull("verified")).toBe("VERIFIED");
    expect(ingestStatusFromPull("partial")).toBe("WARNING");
    expect(ingestStatusFromPull("invalid")).toBe("UNVERIFIED");
  });
});
