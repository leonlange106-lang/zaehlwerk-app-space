import { describe, expect, it } from "vitest";
import { isPinComplete } from "./PinInput";

// A code is submitted the moment this predicate turns true, so what counts as
// "complete" IS the bug surface. `value.length === 6` was the original test, and
// it accepted a padded gap — five digits and a space — which the server rejects
// as invalid every time, with nothing on screen to explain it.

describe("isPinComplete", () => {
  it("accepts six digits", () => {
    expect(isPinComplete("074160")).toBe(true);
    expect(isPinComplete("000000")).toBe(true);
  });

  it("rejects a gap held open by padding", () => {
    // The reported failure, exactly. Tapping the second box first and typing six
    // digits leaves box one empty; `setDigit` pads it with a space, so the value
    // is six characters long while carrying only five digits.
    expect(isPinComplete(" 07410")).toBe(false);
    expect(isPinComplete("07 410")).toBe(false);
    expect(isPinComplete("0741 0")).toBe(false);
  });

  it("rejects anything shorter", () => {
    expect(isPinComplete("")).toBe(false);
    expect(isPinComplete("07416")).toBe(false);
  });

  it("rejects anything longer", () => {
    expect(isPinComplete("0741600")).toBe(false);
  });

  it("rejects non-digits outright", () => {
    expect(isPinComplete("07-160")).toBe(false);
    expect(isPinComplete("abcdef")).toBe(false);
  });

  it("honours a different length", () => {
    expect(isPinComplete("1234", 4)).toBe(true);
    expect(isPinComplete("12 4", 4)).toBe(false);
    expect(isPinComplete("074160", 4)).toBe(false);
  });

  it("agrees with what the server will accept", () => {
    // The two must not disagree: verifyTotp strips non-digits and requires
    // exactly six, so any value this predicate passes must survive that, and any
    // value it rejects must be one the server would have rejected too.
    const serverAccepts = (value: string) => value.replace(/\D/g, "").length === 6;
    for (const value of ["074160", " 07410", "07 410", "07416", "0741600", "abcdef", ""]) {
      expect(isPinComplete(value), `disagreement on ${JSON.stringify(value)}`).toBe(
        serverAccepts(value) && value.length === 6,
      );
    }
  });
});
