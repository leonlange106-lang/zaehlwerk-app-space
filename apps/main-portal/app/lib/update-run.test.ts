import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizeDeployLabel, updateTokenAccepted, updateTokenRequired } from "./update-run";

// `deployInProgress` liest die Statusdatei, deren Pfad beim Laden des Moduls
// aus der Umgebung festgelegt wird — also Umgebung setzen, DANN importieren.
async function askDeployInProgress(status: unknown | null): Promise<boolean> {
  const dir = mkdtempSync(path.join(tmpdir(), "zw-update-"));
  const file = path.join(dir, "update-status.json");
  if (status !== null) {
    writeFileSync(file, typeof status === "string" ? status : JSON.stringify(status));
  }
  try {
    vi.stubEnv("UPDATE_STATUS_FILE", file);
    vi.resetModules();
    const { deployInProgress } = await import("./update-run");
    return await deployInProgress();
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
}

// Warum das Ganze: Das automatische Backup kopiert die Datenbank mit
// `VACUUM INTO` und haelt dabei eine Lesetransaktion ueber die ganze Kopie
// offen. Ohne WAL sperrt das jeden Schreiber aus — auch die Migration eines
// Updates, die absichtlich neben der laufenden Anwendung arbeitet. Genau so ist
// ein Update gescheitert, und Wiederholen half nicht: Es gibt keine Luecke.
describe("deployInProgress", () => {
  it("meldet einen laufenden Deploy", async () => {
    expect(await askDeployInProgress({ done: false, updatedAt: new Date().toISOString() })).toBe(true);
  });

  it("meldet einen abgeschlossenen Deploy nicht", async () => {
    expect(await askDeployInProgress({ done: true, updatedAt: new Date().toISOString() })).toBe(false);
  });

  it("ohne Statusdatei laeuft kein Deploy", async () => {
    // Der Normalfall auf jeder Instanz, die noch nie aktualisiert hat. Hier
    // „ja" zu sagen legte Backup und Wartung fuer immer stumm.
    expect(await askDeployInProgress(null)).toBe(false);
  });

  it("eine unlesbare Statusdatei blockiert die Dienste nicht", async () => {
    expect(await askDeployInProgress("{kaputt")).toBe(false);
  });

  it("haelt einen abgestuerzten Lauf nicht ewig fuer laufend", async () => {
    // `done: false` und drei Stunden alt: Der Lauf ist gestorben, ohne seinen
    // Status zu schliessen. Ohne diese Grenze bliebe das Backup fuer immer aus.
    const drei = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(await askDeployInProgress({ done: false, updatedAt: drei })).toBe(false);
  });

  it("ohne Zeitstempel im Zweifel fuer das Pausieren", async () => {
    // Ein verschobenes Backup ist harmloser als ein abgebrochenes Update.
    expect(await askDeployInProgress({ done: false })).toBe(true);
  });
});

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
