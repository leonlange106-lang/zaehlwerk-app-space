import { describe, expect, it } from "vitest";
import { MGFLASHER_HOST, parseShareLink } from "./mgflasher";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("parseShareLink", () => {
  it("accepts a well-formed share link and derives the CSV url", () => {
    const res = parseShareLink(`https://${MGFLASHER_HOST}/log/${UUID}`);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.uuid).toBe(UUID);
      expect(res.canonicalUrl).toBe(`https://${MGFLASHER_HOST}/log/${UUID}`);
      expect(res.csvUrl).toBe(`https://${MGFLASHER_HOST}/log/${UUID}/export.csv`);
    }
  });

  it("tolerates a trailing slash and surrounding whitespace", () => {
    const res = parseShareLink(`  https://${MGFLASHER_HOST}/log/${UUID}/  `);
    expect(res.ok).toBe(true);
  });

  it("honours a base override for the CSV endpoint", () => {
    const res = parseShareLink(`https://${MGFLASHER_HOST}/log/${UUID}`, "https://proxy.internal");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.csvUrl).toBe(`https://proxy.internal/log/${UUID}/export.csv`);
  });

  it("rejects an empty input", () => {
    expect(parseShareLink("   ").ok).toBe(false);
  });

  it("rejects a non-URL string", () => {
    expect(parseShareLink("not a url").ok).toBe(false);
  });

  it("rejects http (non-https) links", () => {
    expect(parseShareLink(`http://${MGFLASHER_HOST}/log/${UUID}`).ok).toBe(false);
  });

  it("rejects a foreign host (SSRF guard)", () => {
    const res = parseShareLink(`https://evil.example.com/log/${UUID}`);
    expect(res.ok).toBe(false);
  });

  it("rejects a host that merely contains the allowed host", () => {
    const res = parseShareLink(`https://logs.mgflasher.com.evil.example/log/${UUID}`);
    expect(res.ok).toBe(false);
  });

  it("rejects a wrong path shape", () => {
    expect(parseShareLink(`https://${MGFLASHER_HOST}/logs/${UUID}`).ok).toBe(false);
  });

  it("rejects a malformed log id", () => {
    expect(parseShareLink(`https://${MGFLASHER_HOST}/log/not-a-uuid`).ok).toBe(false);
  });
});
