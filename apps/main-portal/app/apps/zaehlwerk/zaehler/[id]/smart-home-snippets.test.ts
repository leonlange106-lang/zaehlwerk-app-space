import { describe, expect, it } from "vitest";
import { buildSnippet, slugify, type SnippetParams } from "./smart-home-snippets";

const BASE: SnippetParams = {
  origin: "https://portal.example",
  meterId: "11111111-1111-4111-8111-111111111111",
  meterName: "Strom",
  token: "zw_pat_beispiel",
};

const ZWEIRICHTUNG: SnippetParams = {
  ...BASE,
  registers: [
    { obisCode: "1.8.0", label: "Bezug" },
    { obisCode: "2.8.0", label: "Einspeisung" },
  ],
};

describe("Eine Reihe — unveraendertes Verhalten", () => {
  it("nennt keine Kennziffer, wenn es nur eine Reihe gibt", () => {
    // Die API legt einen Stand ohne `obisCode` auf dem Bezug ab. Ein Feld
    // hinzuzufuegen, wo es nichts zu unterscheiden gibt, macht die Vorlage nur
    // laenger — und eine bestehende Automation soll unveraendert weiterlaufen.
    for (const kind of ["curl", "homeassistant", "nodered"] as const) {
      expect(buildSnippet(kind, BASE)).not.toContain("obisCode");
    }
  });

  it("behandelt ein einzelnes Register wie gar keines", () => {
    const einzeln = { ...BASE, registers: [{ obisCode: "1.8.0", label: "Bezug" }] };
    expect(buildSnippet("curl", einzeln)).not.toContain("obisCode");
  });
});

describe("Zweirichtungszaehler — zwei Reihen, zwei Meldungen", () => {
  it("erzeugt je Register einen curl-Aufruf mit seiner Kennziffer", () => {
    const out = buildSnippet("curl", ZWEIRICHTUNG);
    expect(out).toContain('"obisCode": "1.8.0"');
    expect(out).toContain('"obisCode": "2.8.0"');
  });

  it("vergibt in Home Assistant je Register einen eigenen Kommandonamen", () => {
    // Der eigentliche Fehler, den das verhindert: Zwei `rest_command`-Eintraege
    // mit demselben Schluessel — der zweite ueberschriebe den ersten
    // stillschweigend, und die Einspeisung wuerde nie gemeldet.
    const out = buildSnippet("homeassistant", ZWEIRICHTUNG);
    expect(out).toContain(`zaehlwerk_${slugify("Strom")}_bezug:`);
    expect(out).toContain(`zaehlwerk_${slugify("Strom")}_einspeisung:`);
    expect(out).toContain('"obisCode":"2.8.0"');
  });

  it("legt in Home Assistant zwei Automationen an, nicht eine", () => {
    const out = buildSnippet("homeassistant", ZWEIRICHTUNG);
    expect(out.match(/- alias:/g)).toHaveLength(2);
  });

  it("erzeugt in Node-RED zwei vollstaendige Straenge mit eindeutigen Ids", () => {
    const flow = JSON.parse(buildSnippet("nodered", ZWEIRICHTUNG)) as { id: string }[];
    const ids = flow.map((node) => node.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });
});
