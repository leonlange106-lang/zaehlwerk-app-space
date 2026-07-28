// Reine Snippet-Generatoren für die Smart-Home-Anbindung. Bewusst
// framework-frei und ohne React, damit sie leicht testbar bleiben und die
// Client-Komponente schlank halten. Alle Funktionen erzeugen kopierfertigen
// Text für den `POST /api/v1/readings`-Endpunkt.

export type SnippetKind = "curl" | "homeassistant" | "nodered";

export interface SnippetParams {
  /** Basis-URL des Portals, z. B. `https://portal.example`. */
  origin: string;
  /** Ziel-Zähler (UUID). */
  meterId: string;
  /** Anzeigename des Zählers — für Kommentare/Entity-Namen. */
  meterName: string;
  /** Platzhalter oder Wert des Personal Access Tokens. */
  token: string;
  /**
   * Register, für die Vorlagen erzeugt werden — OBIS-Kennziffer plus Name.
   *
   * Leer oder einelementig: eine Meldung wie bisher, ohne `obisCode` im Payload
   * (der Zähler hat nur eine Reihe, und die API nimmt ohne Angabe den Bezug).
   * Mehrere: je Register eine eigene Meldung. Ein Zweirichtungszähler führt
   * Bezug und Einspeisung getrennt, und **eine** Automation für beide gäbe es
   * nicht — sie würde die zweite Reihe in die erste schreiben.
   */
  registers?: { obisCode: string; label: string }[];
}

const READINGS_PATH = "/api/v1/readings";

/**
 * Die Register, für die Vorlagen entstehen — immer mindestens eines.
 *
 * Ein leerer Eintrag ohne Kennziffer steht für „so wie bisher": Die API legt
 * einen Stand ohne `obisCode` auf dem Bezug ab, und eine bestehende Automation
 * soll unverändert weiterlaufen.
 */
function targets(params: SnippetParams): { obisCode: string | null; label: string }[] {
  const list = params.registers ?? [];
  if (list.length < 2) return [{ obisCode: null, label: params.meterName }];
  return list.map((reg) => ({ obisCode: reg.obisCode, label: reg.label }));
}

/** Slug für Home-Assistant-Entity-/Command-Namen (nur a-z0-9_). */
export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return slug || "zaehler";
}

function curlSnippet(params: SnippetParams): string {
  const { origin, meterId, token } = params;
  const now = new Date().toISOString();
  return targets(params)
    .map(({ obisCode, label }) =>
      [
        obisCode ? `# ${label} (${obisCode})` : null,
        `curl -X POST "${origin}${READINGS_PATH}" \\`,
        `  -H "Authorization: Bearer ${token}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '{`,
        `    "meterId": "${meterId}",`,
        obisCode ? `    "obisCode": "${obisCode}",` : null,
        `    "value": 1234.56,`,
        `    "timestamp": "${now}"`,
        `  }'`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    )
    .join("\n\n");
}

function homeAssistantSnippet(params: SnippetParams): string {
  const { origin, meterId, meterName, token } = params;
  const list = targets(params);
  const base = slugify(meterName);
  const named = list.map(({ obisCode, label }) => ({
    obisCode,
    label,
    // Ein Kommando je Register — der Slug trägt das Register mit, sonst
    // überschriebe das zweite `rest_command` schlicht das erste.
    slug: obisCode ? `${base}_${slugify(label)}` : base,
  }));

  const commands = named.flatMap(({ obisCode, slug }) => [
    `  zaehlwerk_${slug}:`,
    `    url: "${origin}${READINGS_PATH}"`,
    "    method: POST",
    "    headers:",
    `      Authorization: "Bearer ${token}"`,
    '    content_type: "application/json"',
    "    payload: >-",
    `      {"meterId":"${meterId}",`,
    ...(obisCode ? [`       "obisCode":"${obisCode}",`] : []),
    `       "value":{{ states('sensor.${slug}_zaehlerstand') | float }},`,
    '       "timestamp":"{{ now().isoformat() }}"}',
  ]);

  const automations = named.flatMap(({ label, slug }) => [
    `  - alias: "Zählwerk ${label} übertragen"`,
    "    trigger:",
    "      - platform: time",
    '        at: "23:55:00"',
    "    action:",
    `      - service: rest_command.zaehlwerk_${slug}`,
  ]);

  return [
    "# configuration.yaml — REST-Command + tägliche Automation",
    ...(named.length > 1
      ? [
          "#",
          "# Zwei Register, zwei Meldungen: Bezug und Einspeisung sind eigene",
          "# Reihen. Die Sensornamen unten sind Platzhalter — trag die deines",
          "# Lesekopfs ein (bei SML liefert er 1.8.0 und 2.8.0 getrennt).",
        ]
      : []),
    "rest_command:",
    ...commands,
    "",
    "automation:",
    ...automations,
  ].join("\n");
}

function nodeRedSnippet(params: SnippetParams): string {
  const { origin, meterId, token } = params;
  const flow = targets(params).flatMap(({ obisCode, label }, index) => {
    const suffix = obisCode ? `_${index}` : "";
    const contextKey = obisCode ? `zaehlerstand${suffix}` : "zaehlerstand";
    return [
      {
        id: `zw_inject${suffix}`,
        type: "inject",
        name: obisCode ? `${label} — täglich 23:55` : "täglich 23:55",
        props: [{ p: "payload" }],
        repeat: "",
        crontab: "55 23 * * *",
        payloadType: "date",
        wires: [[`zw_build${suffix}`]],
      },
      {
        id: `zw_build${suffix}`,
        type: "function",
        name: obisCode ? `Payload bauen (${obisCode})` : "Payload bauen",
        func:
          "// Zählerstand aus deiner Quelle einsetzen (z. B. flow/global context):\n" +
          `const value = flow.get('${contextKey}') || 1234.56;\n` +
          "msg.headers = {\n" +
          `  'Authorization': 'Bearer ${token}',\n` +
          "  'Content-Type': 'application/json'\n" +
          "};\n" +
          "msg.payload = {\n" +
          `  meterId: '${meterId}',\n` +
          (obisCode ? `  obisCode: '${obisCode}',\n` : "") +
          "  value: value,\n" +
          "  timestamp: new Date().toISOString()\n" +
          "};\n" +
          "return msg;",
        outputs: 1,
        wires: [[`zw_request${suffix}`]],
      },
      {
        id: `zw_request${suffix}`,
        type: "http request",
        name: "POST /api/v1/readings",
        method: "POST",
        ret: "obj",
        url: `${origin}${READINGS_PATH}`,
        wires: [[]],
      },
    ];
  });
  return JSON.stringify(flow, null, 2);
}

export function buildSnippet(kind: SnippetKind, params: SnippetParams): string {
  switch (kind) {
    case "curl":
      return curlSnippet(params);
    case "homeassistant":
      return homeAssistantSnippet(params);
    case "nodered":
      return nodeRedSnippet(params);
  }
}
