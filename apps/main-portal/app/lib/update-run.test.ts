import { afterEach, describe, expect, it } from "vitest";
import { sanitizeDeployLabel, updateTokenAccepted, updateTokenRequired } from "./update-run";

describe("sanitizeDeployLabel", () => {
  it("leaves an ordinary release name alone", () => {
    expect(sanitizeDeployLabel("3.0.0 Beta 3 (v3.0.0-beta.3)")).toBe("3.0.0 Beta 3 (v3.0.0-beta.3)");
  });

  it("strips the quotes and backslashes that would break the shell's JSON", () => {
    expect(sanitizeDeployLabel('he said "hi" \\ there')).toBe("he said hi there");
  });

  it("strips a newline so one record cannot become two", () => {
    // deploy-swap.sh appends one JSON object per line; a newline in the label
    // would split the record and corrupt the entry after it.
    // The quotes become spaces before the whitespace collapses, so the injected
    // object arrives inert AND on one line — which is the property that matters.
    const sanitized = sanitizeDeployLabel('3.0.0\n{"sha":"evil"}');
    expect(sanitized).not.toContain("\n");
    expect(sanitized).not.toContain('"');
    expect(sanitized).toBe("3.0.0 { sha : evil }");
  });

  it("collapses the whitespace left behind by stripping", () => {
    expect(sanitizeDeployLabel('a  "  "  b')).toBe("a b");
  });

  it("caps the length so one release name cannot bloat every history line", () => {
    expect(sanitizeDeployLabel("x".repeat(500))).toHaveLength(120);
  });

  it("falls back to a placeholder rather than emitting an empty label", () => {
    expect(sanitizeDeployLabel('   ""   ')).toBe("unbenannt");
    expect(sanitizeDeployLabel("")).toBe("unbenannt");
  });
});

describe("updateTokenAccepted", () => {
  const original = process.env.UPDATE_TRIGGER_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.UPDATE_TRIGGER_TOKEN;
    else process.env.UPDATE_TRIGGER_TOKEN = original;
  });

  it("accepts anything when no token is configured", () => {
    delete process.env.UPDATE_TRIGGER_TOKEN;
    expect(updateTokenRequired()).toBe(false);
    expect(updateTokenAccepted(null)).toBe(true);
    expect(updateTokenAccepted("whatever")).toBe(true);
  });

  it("requires a matching token when one is configured", () => {
    process.env.UPDATE_TRIGGER_TOKEN = "s3cret";
    expect(updateTokenRequired()).toBe(true);
    expect(updateTokenAccepted("s3cret")).toBe(true);
    expect(updateTokenAccepted("wrong!")).toBe(false);
    expect(updateTokenAccepted(null)).toBe(false);
    expect(updateTokenAccepted("")).toBe(false);
  });

  it("rejects a length mismatch without throwing", () => {
    // timingSafeEqual throws on differing lengths, so the guard must come first.
    process.env.UPDATE_TRIGGER_TOKEN = "s3cret";
    expect(() => updateTokenAccepted("s3")).not.toThrow();
    expect(updateTokenAccepted("s3")).toBe(false);
    expect(updateTokenAccepted("s3cret-and-then-some")).toBe(false);
  });
});
