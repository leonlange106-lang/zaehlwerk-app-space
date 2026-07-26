import { describe, expect, it } from "vitest";
import { parseDeployHistory } from "./deploy-history";

describe("parseDeployHistory", () => {
  it("parses one record per line, oldest first", () => {
    const raw = [
      '{"at":"2026-07-01T00:00:00Z","sha":"a1","ref":"v1.0.0","label":"1.0.0","channel":"stable","mode":"update"}',
      '{"at":"2026-07-02T00:00:00Z","sha":"b2","ref":"v2.0.0","label":"2.0.0","channel":"beta","mode":"update"}',
    ].join("\n");

    const records = parseDeployHistory(raw);
    expect(records.map((r) => r.ref)).toEqual(["v1.0.0", "v2.0.0"]);
    expect(records[1].channel).toBe("beta");
  });

  it("survives a torn final line", () => {
    // The container is recreated mid-append during every single deploy, so a
    // half-written last line is expected, not exotic.
    const raw =
      '{"at":"2026-07-01T00:00:00Z","sha":"a1","ref":"v1.0.0","label":"1.0.0","channel":"stable","mode":"update"}\n' +
      '{"at":"2026-07-02T00:00:00Z","sha":"b2","ref":"v2';

    const records = parseDeployHistory(raw);
    expect(records).toHaveLength(1);
    expect(records[0].sha).toBe("a1");
  });

  it("skips records with no commit — they cannot be rolled back to", () => {
    const raw = [
      '{"at":"2026-07-01T00:00:00Z","sha":"","ref":"v1.0.0"}',
      '{"at":"2026-07-02T00:00:00Z","ref":"v2.0.0"}',
      '{"at":"2026-07-03T00:00:00Z","sha":"c3","ref":"v3.0.0"}',
    ].join("\n");

    expect(parseDeployHistory(raw).map((r) => r.sha)).toEqual(["c3"]);
  });

  it("ignores blank lines and non-object JSON", () => {
    const raw = ['', '"just a string"', "123", "null", '{"sha":"a1","ref":"v1.0.0"}', "  "].join(
      "\n",
    );

    expect(parseDeployHistory(raw)).toHaveLength(1);
  });

  it("defaults a missing label to the ref, then to the short SHA", () => {
    const raw = [
      '{"sha":"a1","ref":"v1.0.0"}',
      '{"sha":"0123456789abcdef0123456789abcdef01234567"}',
    ].join("\n");

    const records = parseDeployHistory(raw);
    expect(records[0].label).toBe("v1.0.0");
    expect(records[1].label).toBe("0123456");
  });

  it("normalises an unknown mode to update", () => {
    const raw = '{"sha":"a1","ref":"v1.0.0","mode":"sideways"}';
    expect(parseDeployHistory(raw)[0].mode).toBe("update");
  });

  it("keeps rollback as its own mode", () => {
    const raw = '{"sha":"a1","ref":"v1.0.0","mode":"rollback"}';
    expect(parseDeployHistory(raw)[0].mode).toBe("rollback");
  });

  it("treats an empty file as an empty history", () => {
    expect(parseDeployHistory("")).toEqual([]);
  });

  it("reads a branch-mode record the way deploy-swap.sh actually writes it", () => {
    // printf has no concept of null, so the script emits ref:"" for a deploy
    // that followed the branch. This is the contract between the two files:
    // verified against real output from scripts/deploy-swap.sh's record_deploy.
    const raw =
      '{"at":"2026-07-26T10:07:03Z","sha":"cccc333","ref":"","label":"Branch main","channel":"stable","mode":"update"}';

    const record = parseDeployHistory(raw)[0];
    expect(record.ref).toBeNull();
    expect(record.label).toBe("Branch main");
  });
});
