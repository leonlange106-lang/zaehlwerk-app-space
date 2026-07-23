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
}

const READINGS_PATH = "/api/v1/readings";

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

function curlSnippet({ origin, meterId, token }: SnippetParams): string {
  return [
    `curl -X POST "${origin}${READINGS_PATH}" \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "meterId": "${meterId}",`,
    `    "value": 1234.56,`,
    `    "timestamp": "${new Date().toISOString()}"`,
    `  }'`,
  ].join("\n");
}

function homeAssistantSnippet({ origin, meterId, meterName, token }: SnippetParams): string {
  const slug = slugify(meterName);
  return [
    "# configuration.yaml — REST-Command + tägliche Automation",
    "rest_command:",
    `  zaehlwerk_${slug}:`,
    `    url: "${origin}${READINGS_PATH}"`,
    "    method: POST",
    "    headers:",
    `      Authorization: "Bearer ${token}"`,
    "    content_type: \"application/json\"",
    "    payload: >-",
    `      {"meterId":"${meterId}",`,
    `       "value":{{ states('sensor.${slug}_zaehlerstand') | float }},`,
    '       "timestamp":"{{ now().isoformat() }}"}',
    "",
    "automation:",
    `  - alias: "Zählwerk ${meterName} übertragen"`,
    "    trigger:",
    '      - platform: time',
    '        at: "23:55:00"',
    "    action:",
    `      - service: rest_command.zaehlwerk_${slug}`,
  ].join("\n");
}

function nodeRedSnippet({ origin, meterId, token }: SnippetParams): string {
  const flow = [
    {
      id: "zw_inject",
      type: "inject",
      name: "täglich 23:55",
      props: [{ p: "payload" }],
      repeat: "",
      crontab: "55 23 * * *",
      payloadType: "date",
      wires: [["zw_build"]],
    },
    {
      id: "zw_build",
      type: "function",
      name: "Payload bauen",
      func:
        "// Zählerstand aus deiner Quelle einsetzen (z. B. flow/global context):\n" +
        "const value = flow.get('zaehlerstand') || 1234.56;\n" +
        "msg.headers = {\n" +
        `  'Authorization': 'Bearer ${token}',\n` +
        "  'Content-Type': 'application/json'\n" +
        "};\n" +
        "msg.payload = {\n" +
        `  meterId: '${meterId}',\n` +
        "  value: value,\n" +
        "  timestamp: new Date().toISOString()\n" +
        "};\n" +
        "return msg;",
      outputs: 1,
      wires: [["zw_request"]],
    },
    {
      id: "zw_request",
      type: "http request",
      name: "POST /api/v1/readings",
      method: "POST",
      ret: "obj",
      url: `${origin}${READINGS_PATH}`,
      wires: [[]],
    },
  ];
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
