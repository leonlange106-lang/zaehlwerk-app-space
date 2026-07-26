import { describe, expect, it } from "vitest";
import { twoFactorGateBlocks } from "./two-factor-policy";

describe("twoFactorGateBlocks", () => {
  it("does not block when the instance does not enforce 2FA", () => {
    expect(
      twoFactorGateBlocks({ enforced: false, userHasTwoFactor: false, mustSetPassword: false }),
    ).toBe(false);
  });

  it("blocks an enrolled-less account once enforcement is on", () => {
    expect(
      twoFactorGateBlocks({ enforced: true, userHasTwoFactor: false, mustSetPassword: false }),
    ).toBe(true);
  });

  it("lets an account with a second factor through", () => {
    expect(
      twoFactorGateBlocks({ enforced: true, userHasTwoFactor: true, mustSetPassword: false }),
    ).toBe(false);
  });

  it("yields to the password gate rather than stacking on top of it", () => {
    // A temp-password account is already being redirected to /set-password.
    // Blocking here too would replace that page with an enrolment screen and ask
    // for a second factor before the account has a first one.
    expect(
      twoFactorGateBlocks({ enforced: true, userHasTwoFactor: false, mustSetPassword: true }),
    ).toBe(false);
  });

  it("still yields to the password gate even if 2FA is somehow already set", () => {
    expect(
      twoFactorGateBlocks({ enforced: true, userHasTwoFactor: true, mustSetPassword: true }),
    ).toBe(false);
  });
});
