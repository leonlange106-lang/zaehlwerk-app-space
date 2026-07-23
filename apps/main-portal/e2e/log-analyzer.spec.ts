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
    await page.route("**/api/apps/log-analyzer/fetch-remote", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          source: VALID,
          log: {
            time: [0, 1, 2, 3],
            timeUnit: "s",
            series: [
              {
                key: "rpm",
                label: "RPM",
                unit: null,
                group: "Engine & Drivetrain",
                color: "#20c997",
                values: [900, 3200, 6100, 6800],
                min: 900,
                max: 6800,
              },
              {
                key: "boost-actual",
                label: "Boost Actual",
                unit: "psi",
                group: "Boost Control",
                color: "#fd7e14",
                values: [0.2, 9.1, 18.2, 17.4],
                min: 0.2,
                max: 18.2,
              },
            ],
            meta: {
              vin: "REMOTESYNTH0001",
              vehicle: null,
              mapVersion: null,
              software: null,
              date: null,
              peakBoost: 18.2,
              peakBoostUnit: "psi",
              maxRpm: 6800,
              gearRange: null,
              duration: 3,
            },
            rowCount: 4,
            skippedRows: 0,
          },
        }),
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
  test("sidebar exposes Analyzer, Remote-Import and Log-Historie", async ({ page }) => {
    await page.goto("/apps/log-analyzer");
    // Open the mobile drawer to reach the nav links.
    await page.getByRole("button", { name: "Navigation umschalten" }).click();
    await page.getByRole("link", { name: "Remote-Import" }).click();
    await page.waitForURL(/\/apps\/log-analyzer\/remote$/);
    await expect(page.getByRole("heading", { name: "Remote-Import" })).toBeVisible();

    await page.getByRole("button", { name: "Navigation umschalten" }).click();
    await page.getByRole("link", { name: "Log-Historie" }).click();
    await page.waitForURL(/\/apps\/log-analyzer\/history$/);
    await expect(page.getByRole("heading", { name: "Log-Historie" })).toBeVisible();
  });
});
