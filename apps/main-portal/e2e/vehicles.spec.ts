import path from "node:path";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@zaehlwerk/database";
import { E2E_RESTRICTED } from "./fixtures";
import { login } from "./helpers";

// Paket G: vehicles as real data.
//
// The point of the package is that a vehicle is a RECORD, not one global blob in
// localStorage. So this spec checks the properties that only a record can have:
// there can be more than one, the choice survives a reload and a different
// browser, and a limit someone typed is the limit that gets stored.

const E2E_DB = path.join(__dirname, ".data", "e2e.db").replace(/\\/g, "/");
const prisma = new PrismaClient({ datasourceUrl: `file:${E2E_DB}` });

test.describe("Vehicles", () => {
  test.beforeEach(async () => {
    await prisma.vehicle.deleteMany();
  });

  test.afterAll(async () => {
    await prisma.vehicle.deleteMany();
    await prisma.$disconnect();
  });

  test("the first save creates a vehicle and it becomes active", async ({ page }) => {
    await page.goto("/apps/log-analyzer/specs");

    const name = page.getByTestId("vehicle-name");
    await expect(name).toBeVisible();
    await name.fill("E92 335i");
    await page.getByTestId("spec-save").click();
    await expect(page.getByTestId("spec-saved")).toBeVisible();

    const rows = await prisma.vehicle.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("E92 335i");
    // The first vehicle must be active, or nothing is scored against anything.
    expect(rows[0].active).toBe(true);
  });

  test("a second vehicle can exist alongside the first", async ({ page }) => {
    // The whole reason for the package: two cars used to overwrite each other.
    await page.goto("/apps/log-analyzer/specs");
    await page.getByTestId("vehicle-name").fill("Auto A");
    await page.getByTestId("spec-save").click();
    await expect(page.getByTestId("spec-saved")).toBeVisible();

    await page.getByTestId("vehicle-new").click();
    await page.getByTestId("vehicle-name").fill("Auto B");
    await page.getByTestId("spec-save").click();
    await expect(page.getByTestId("spec-saved")).toBeVisible();

    const names = (await prisma.vehicle.findMany({ orderBy: { name: "asc" } })).map((v) => v.name);
    expect(names).toEqual(["Auto A", "Auto B"]);
  });

  test("exactly one vehicle is active after switching", async ({ page }) => {
    await prisma.vehicle.createMany({
      data: [
        { name: "Erstwagen", active: true },
        { name: "Zweitwagen", active: false },
      ],
    });
    await page.goto("/apps/log-analyzer/specs");

    const picker = page.getByTestId("vehicle-picker");
    await expect(picker).toBeVisible();
    const second = await prisma.vehicle.findFirstOrThrow({ where: { name: "Zweitwagen" } });
    await picker.selectOption(second.id);

    // Poll the NAME, not the count: one vehicle was already active before the
    // switch, so a count of 1 is satisfied by the state we are trying to leave
    // and the assertion would pass without anything having happened.
    await expect
      .poll(async () =>
        (await prisma.vehicle.findFirst({ where: { active: true } }))?.name,
      )
      .toBe("Zweitwagen");

    // "Exactly one" is the invariant the whole feature rests on: with two, the
    // active vehicle is whichever the database felt like returning.
    expect(await prisma.vehicle.count({ where: { active: true } })).toBe(1);
  });

  test("a manual limit is stored, and marked as manual on screen", async ({ page }) => {
    await page.goto("/apps/log-analyzer/specs");
    await page.getByTestId("vehicle-name").fill("Mit eigenem Limit");
    await page.getByTestId("limit-maxEgt").fill("950");

    // Red alone would break the rule that colour never carries meaning by
    // itself — greyscale prints and red-green deficiency both lose it.
    await expect(page.getByTestId("limit-manual-maxEgt")).toBeVisible();
    await expect(page.getByTestId("limit-manual-maxEgt")).toHaveText("manuell");

    await page.getByTestId("spec-save").click();
    await expect(page.getByTestId("spec-saved")).toBeVisible();

    const row = await prisma.vehicle.findFirstOrThrow();
    expect(JSON.parse(row.limitOverrides)).toEqual({ maxEgt: 950 });
  });

  test("only the overridden limit is stored, not a frozen copy of them all", async ({ page }) => {
    // A full copy would freeze the vehicle at the day it was created: every
    // later correction to the threshold tables would stop reaching it.
    await page.goto("/apps/log-analyzer/specs");
    await page.getByTestId("vehicle-name").fill("Nur eins");
    await page.getByTestId("limit-maxEgt").fill("950");
    await page.getByTestId("spec-save").click();
    await expect(page.getByTestId("spec-saved")).toBeVisible();

    const row = await prisma.vehicle.findFirstOrThrow();
    expect(Object.keys(JSON.parse(row.limitOverrides))).toEqual(["maxEgt"]);
  });

  test("an implausible limit is refused rather than stored", async ({ page }) => {
    // A typo of one order of magnitude does not look wrong on screen — it
    // silently reclassifies every log evaluated afterwards.
    await page.goto("/apps/log-analyzer/specs");
    await page.getByTestId("vehicle-name").fill("Tippfehler");
    await page.getByTestId("limit-maxEgt").fill("95000");
    await page.getByTestId("spec-save").click();
    await expect(page.getByTestId("spec-saved")).toBeVisible();

    const row = await prisma.vehicle.findFirstOrThrow();
    expect(JSON.parse(row.limitOverrides)).toEqual({});
  });

  test("the selection survives a reload", async ({ page }) => {
    await prisma.vehicle.createMany({
      data: [
        { name: "Alpha", active: false },
        { name: "Beta", active: true },
      ],
    });
    await page.goto("/apps/log-analyzer/specs");
    await expect(page.getByTestId("vehicle-name")).toHaveValue("Beta");

    // Server-side, not per browser — that is the difference from localStorage.
    await page.reload();
    await expect(page.getByTestId("vehicle-name")).toHaveValue("Beta");
  });
});

test.describe("Vehicle actions respect app access", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a restricted account cannot reach the specs page", async ({ page }) => {
    // The layout guard bounces it; the actions themselves also assert access,
    // because a "use server" export is a POST endpoint of its own.
    await login(page, E2E_RESTRICTED);
    await page.goto("/apps/log-analyzer/specs");
    await expect(page).toHaveURL(/\/$/);
  });
});
