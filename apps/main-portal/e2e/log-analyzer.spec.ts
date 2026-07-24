import { test, expect, type Page } from "@playwright/test";
import { ERROR_BOUNDARY_TEXT } from "./fixtures";

// The seeded E2E admin has the log-analyzer app assigned, so these run from the
// stored admin session. All data here is SYNTHETIC — no real logs or links.

// Mantine's TextInput is controlled; WebKit can drop a fast fill() before React
// commits, so type the value and assert it landed (mirrors e2e/helpers.ts).
async function typeUrl(page: Page, value: string) {
  const field = page.getByTestId("remote-url");
  await field.click();
  await field.fill("");
  await field.pressSequentially(value, { delay: 8 });
  await expect(field).toHaveValue(value);
}

/**
 * Load the built-in Baseline (A) and Comparison (B) samples on the compare page.
 *
 * Two ordering hazards, both of which flaked on WebKit:
 *  - the view fetches the stored-log list in an effect, and once any log exists
 *    that render inserts a history Select ABOVE the buttons in both picker
 *    cards. A click dispatched into the pre-shift layout is lost, so wait for
 *    that request to settle before touching anything.
 *  - the two clicks must each be confirmed via their "picked" badge; firing
 *    them back-to-back can drop the second.
 */
async function loadBothSamples(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Beispiel" }).nth(0).click();
  await expect(page.getByTestId("picked-a")).toBeVisible();
  await page.getByRole("button", { name: "Beispiel" }).nth(1).click();
  await expect(page.getByTestId("picked-b")).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `no horizontal scroll (sw ${scrollWidth} vs iw ${innerWidth})`).toBeLessThanOrEqual(
    innerWidth + 1,
  );
}

const SAMPLE_CSV = [
  "# VIN: WBSUPLOAD0SYNTH99",
  "# Vehicle: Upload Test Coupe",
  "Time (s),RPM,Boost Actual (psi),Ignition Timing (deg)",
  "0.0,900,0.2,13.0",
  "0.1,3500,9.5,7.0",
  "0.2,6200,18.5,3.5",
  "0.3,6800,17.0,4.0",
].join("\n");

/** Stands in for the CSV the (mocked) MGflasher host would serve. */
const REMOTE_CSV = [
  "# VIN: REMOTESYNTH0001",
  "# Vehicle: Remote Import Coupe",
  "Time (s),RPM,Boost Actual (psi),Ignition Timing (deg)",
  "0.0,900,0.2,13.0",
  "0.1,3200,9.1,7.0",
  "0.2,6100,18.2,3.5",
  "0.3,6800,17.4,4.0",
].join("\n");

test.describe("Log Analyzer: local upload", () => {
  test("uploading a CSV renders metadata and synchronized charts", async ({ page }) => {
    await page.goto("/apps/log-analyzer");
    await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);

    // The empty state exposes exactly one file input (Mantine FileButton).
    await page.locator('input[type="file"]').setInputFiles({
      name: "upload-test.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(SAMPLE_CSV),
    });

    // Metadata extracted from the header block.
    await expect(page.getByText("WBSUPLOAD0SYNTH99")).toBeVisible();
    await expect(page.getByText("Upload Test Coupe")).toBeVisible();

    // Charts rendered (one Recharts surface per selected parameter group).
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
    expect(await page.locator(".recharts-surface").count()).toBeGreaterThan(0);

    await expectNoHorizontalScroll(page);
  });

  test("the built-in sample loads without a file and can be explored", async ({ page }) => {
    await page.goto("/apps/log-analyzer");
    await page.getByRole("button", { name: "Beispiel laden" }).click();

    await expect(page.getByText("WBSDEMO0SYNTHETIC1")).toBeVisible();
    const chartsBefore = await page.locator(".recharts-surface").count();
    expect(chartsBefore).toBeGreaterThan(0);

    // Toggling a channel off updates the charts (interaction). RPM is the only
    // Engine channel in the default selection, so its group chart disappears.
    await page.getByRole("checkbox", { name: /RPM/ }).uncheck();
    await expect
      .poll(async () => page.locator(".recharts-surface").count())
      .toBeLessThan(chartsBefore);

    await expectNoHorizontalScroll(page);
  });
});

test.describe("Log Analyzer: remote import", () => {
  const VALID = "https://logs.mgflasher.com/log/0f8fad5b-d9cb-469f-a165-70867728950e";

  test("rejects an invalid share link client-side (button stays disabled)", async ({ page }) => {
    await page.goto("/apps/log-analyzer/remote");
    const button = page.getByRole("button", { name: "Prüfen & Importieren" });
    await expect(button).toBeDisabled();

    await typeUrl(page, "https://evil.example.com/log/123");
    await expect(button).toBeDisabled();
    await expect(page.getByText(/Nur Links von logs.mgflasher.com/)).toBeVisible();
  });

  test("a valid link imports (mocked) and opens in the analyzer", async ({ page }) => {
    // Mock the server route so the test never touches the real MGflasher host.
    // The shape must match the real route: it returns the raw `csv`, which the
    // view persists via uploadLogs and then opens by id. (A mock that only
    // carries a pre-parsed `log` silently fails the view's `!json.csv` guard.)
    await page.route("**/api/apps/log-analyzer/fetch-remote", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, source: VALID, csv: REMOTE_CSV }),
      });
    });

    await page.goto("/apps/log-analyzer/remote");
    await typeUrl(page, VALID);
    const button = page.getByRole("button", { name: "Prüfen & Importieren" });
    await expect(button).toBeEnabled();
    await button.click();

    await page.waitForURL(/\/apps\/log-analyzer$/);
    await expect(page.getByText("REMOTESYNTH0001")).toBeVisible();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
  });
});

test.describe("Log Analyzer: sub-navigation", () => {
  test("sidebar exposes Analyzer, Remote-Import and Log-Übersicht", async ({ page }) => {
    await page.goto("/apps/log-analyzer");
    // Open the mobile drawer to reach the nav links.
    await page.getByRole("button", { name: "Navigation umschalten" }).click();
    await page.getByRole("link", { name: "Remote-Import" }).click();
    await page.waitForURL(/\/apps\/log-analyzer\/remote$/);
    await expect(page.getByRole("heading", { name: "Remote-Import" })).toBeVisible();

    await page.getByRole("button", { name: "Navigation umschalten" }).click();
    await page.getByRole("link", { name: "Log-Übersicht" }).click();
    await page.waitForURL(/\/apps\/log-analyzer\/history$/);
    await expect(page.getByRole("heading", { name: "Log-Übersicht" })).toBeVisible();
  });
});

// ── Phase 8.1 ──────────────────────────────────────────────────────────────

// A synthetic VERIFIED pull that deliberately omits STFT/LTFT so the analyzer
// surfaces both the VERIFIED badge and the missing-parameter hints.
const PULL_CSV = [
  "# VIN: WBSEVAL0SYNTH123",
  "# Vehicle: Eval Test Coupe",
  "Time (s),RPM,Pedal (%),Boost Target (psi),Boost Actual (psi),Ignition Correction (deg),Gear",
  "0.0,1000,100,2.0,1.8,0,3",
  "0.1,2500,100,10.0,9.5,0,3",
  "0.2,4500,100,18.0,17.6,0,3",
  "0.3,6200,100,17.0,16.6,0,3",
  "0.4,7000,100,16.0,15.6,0,3",
].join("\n");

test.describe("Log Analyzer: automated pull evaluation", () => {
  test("a valid pull is rated VERIFIED and missing fuel trims are flagged", async ({ page }) => {
    await page.goto("/apps/log-analyzer");
    await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);

    await page.locator('input[type="file"]').setInputFiles({
      name: "eval-pull.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(PULL_CSV),
    });

    // The evaluation card and its status badge render.
    await expect(page.getByTestId("evaluation-card")).toBeVisible();
    await expect(page.getByTestId("pull-status")).toHaveText("VERIFIED PULL");

    // STFT/LTFT are absent → explicit logging-profile hints.
    const missing = page.getByTestId("missing-params");
    await expect(missing).toBeVisible();
    await expect(missing.getByText(/STFT nicht im Log/)).toBeVisible();
    await expect(missing.getByText(/LTFT nicht im Log/)).toBeVisible();

    await expectNoHorizontalScroll(page);
  });

  test("the built-in sample raises knock/EGT-free VERIFIED result", async ({ page }) => {
    await page.goto("/apps/log-analyzer");
    await page.getByRole("button", { name: "Beispiel laden" }).click();
    await expect(page.getByTestId("pull-status")).toHaveText("VERIFIED PULL");
  });
});

test.describe("Log Analyzer: dual-log comparison", () => {
  test("loading two logs renders diff cards and an RPM overlay", async ({ page }) => {
    await page.goto("/apps/log-analyzer/compare");
    await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);

    await loadBothSamples(page);

    // Diff cards + overlay chart appear once both sides are loaded.
    await expect(page.getByTestId("diff-cards")).toBeVisible();
    await expect(page.getByText("Peak Boost")).toBeVisible();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();

    // Switching the overlay channel keeps the chart rendered.
    await page.getByTestId("overlay-channel").getByText("IAT").click();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();

    await expectNoHorizontalScroll(page);
  });

  test("the overlay switches between the RPM and the WOT-aligned time axis", async ({ page }) => {
    await page.goto("/apps/log-analyzer/compare");
    await loadBothSamples(page);
    await expect(page.getByTestId("diff-cards")).toBeVisible();

    // Alignment only applies to the time axis, so it starts disabled on RPM.
    const align = page.getByTestId("overlay-align");
    await expect(align.getByRole("radio", { name: "WOT-Start (t=0)" })).toBeDisabled();

    await page.getByTestId("overlay-axis").getByText("Zeit (s)").click();
    await expect(align.getByRole("radio", { name: "WOT-Start (t=0)" })).toBeEnabled();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();

    // Both alignment modes render; the aligned one marks t = 0.
    await expect(page.locator("text=WOT").first()).toBeVisible();
    await align.getByText("Roh-Zeitachse").click();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();

    await expectNoHorizontalScroll(page);
  });

  test("boost overlays target as a companion trace on all four lines", async ({ page }) => {
    await page.goto("/apps/log-analyzer/compare");
    await loadBothSamples(page);
    await expect(page.getByTestId("diff-cards")).toBeVisible();

    // Boost is the default channel: A/B actual + A/B target = four line traces.
    await expect(page.locator(".recharts-line")).toHaveCount(4);
    await expect(page.getByText(/gepunktet: Target/)).toBeVisible();

    // A single-trace channel drops back to two lines.
    await page.getByTestId("overlay-channel").getByText("WGDC").click();
    await expect(page.locator(".recharts-line")).toHaveCount(2);
  });
});

test.describe("Log Analyzer: vehicle & hardware profile", () => {
  test("changing the catalyst updates the derived EGT limit and saves", async ({ page }) => {
    await page.goto("/apps/log-analyzer/specs");
    await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Fahrzeug- & Motor-Profil" })).toBeVisible();

    // Default OEM cat → 960 °C ceiling.
    await expect(page.getByText("960 °C")).toBeVisible();

    // Switch to catless → looser ceiling (1010 °C).
    await page.getByTestId("spec-cat").click();
    await page.getByRole("option", { name: "Catless (kein Kat)" }).click();
    await expect(page.getByText("1010 °C")).toBeVisible();

    await page.getByTestId("spec-save").click();
    await expect(page.getByTestId("spec-saved")).toBeVisible();

    await expectNoHorizontalScroll(page);
  });
});

test.describe("Log Analyzer: virtual dyno", () => {
  test("the sample log yields power/torque curves and the profile drawer edits them", async ({
    page,
  }) => {
    await page.goto("/apps/log-analyzer/dyno");
    await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Virtueller Prüfstand" })).toBeVisible();

    // The stored-log list arrives via an effect and inserts a Select above the
    // buttons; wait for it so the click lands on the settled layout.
    await page.waitForLoadState("networkidle");
    await page.getByTestId("dyno-sample").click();
    await expect(page.getByTestId("dyno-peaks")).toBeVisible();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();

    // Power (+ its cross-check trace) and torque are drawn.
    await expect(page.locator(".recharts-line")).toHaveCount(3);

    // Wheel figures must come out below the crank ones.
    const peakCard = page.getByTestId("dyno-peaks");
    const crankPeak = await peakCard.getByText(/ PS$/).first().textContent();
    await page.getByTestId("dyno-output").getByText("Rad").click();
    const wheelPeak = await peakCard.getByText(/ PS$/).first().textContent();
    const toNumber = (text: string | null) => Number((text ?? "").replace(/[^\d]/g, ""));
    expect(toNumber(wheelPeak)).toBeLessThan(toNumber(crankPeak));

    // A lower drivetrain loss leaves more power at the wheels.
    await page.getByTestId("dyno-open-profile").click();
    const loss = page.getByTestId("dyno-loss");
    await expect(loss).toBeVisible();
    await loss.fill("5");
    await page.getByTestId("dyno-save").click();
    await expect(page.getByTestId("dyno-drawer")).toBeHidden();
    const lessLossPeak = await peakCard.getByText(/ PS$/).first().textContent();
    expect(toNumber(lessLossPeak)).toBeGreaterThan(toNumber(wheelPeak));

    await expectNoHorizontalScroll(page);
  });

  test("the SAE/DIN correction toggle rescales the estimate", async ({ page }) => {
    await page.goto("/apps/log-analyzer/dyno");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("dyno-sample").click();
    await expect(page.getByTestId("dyno-peaks")).toBeVisible();

    // The sample carries no ambient channels, so both standards correct it away
    // from 1.000 by a factor the peak card spells out.
    const peakCard = page.getByTestId("dyno-peaks");
    await expect(peakCard.getByText("Unkorrigiert")).toBeVisible();
    await page.getByTestId("dyno-correction").getByText("DIN 70020").click();
    await expect(peakCard.getByText(/DIN 70020 · ×/)).toBeVisible();
    await page.getByTestId("dyno-correction").getByText("SAE J1349").click();
    await expect(peakCard.getByText(/SAE J1349 · ×/)).toBeVisible();
  });
});
