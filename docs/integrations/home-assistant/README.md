# Home Assistant & Smart-Home-Integration

Automatische Übertragung von Zählerständen an Zählwerk – aus Home Assistant,
Node-RED oder direkt vom Gerät (ESPHome, Tasmota, Shelly). Alle Wege sprechen
denselben Endpunkt an:

```
POST /api/v1/readings
Authorization: Bearer zw_pat_…
Content-Type: application/json

{ "meterId": "<uuid>", "value": 1234.56, "timestamp": "2026-07-23T21:55:00Z" }
```

`timestamp` ist optional (Default: Serverzeit bei Empfang). Die Antwort enthält
die berechnete Verbrauchsdifferenz zur vorherigen Ablesung. Sinkt der Zählerstand
(unplausibel), antwortet der Endpunkt mit `422` – bei einem echten Zählertausch
`zaehlerGetauscht: true` + `startwertNeu` mitsenden, oder einmalig
`allowImplausible: true`.

> **Tipp:** Fertige, auf deinen Zähler zugeschnittene Snippets (mit korrekter
> URL und Meter-ID) findest du direkt in der App unter **Zählwerk → Zähler
> öffnen → Smart Home & Automatische Auslesung**. Die Dateien hier sind die
> generische, versionierte Vorlage dazu.

## Inhalt

| Datei | Zweck |
| --- | --- |
| [`configuration.yaml`](./configuration.yaml) | `rest_command` + `secrets.yaml`-Vorlage und eine manuelle Beispiel-Automation |
| [`blueprints/zaehlwerk_push_reading.yaml`](./blueprints/zaehlwerk_push_reading.yaml) | Home-Assistant-Blueprint: einen Sensor zeitgesteuert an Zählwerk übertragen |
| [`devices/esphome.yaml`](./devices/esphome.yaml) | ESPHome-Gerät sendet direkt (ohne HA) per `http_request` |
| [`devices/tasmota-rule.txt`](./devices/tasmota-rule.txt) | Tasmota-Regel mit `WebQuery` (direkter POST) |
| [`devices/shelly-script.js`](./devices/shelly-script.js) | Shelly-Gen2-Skript (`Shelly.call("HTTP.POST", …)`) |

## Schritt 1 – Personal Access Token (PAT) erzeugen

1. In Zählwerk: **Einstellungen → API-Zugriff → Token erstellen**.
2. Namen vergeben (z. B. `home-assistant`), optional ein Ablaufdatum.
3. Den angezeigten Token (`zw_pat_…`) **sofort kopieren** – er wird aus
   Sicherheitsgründen nur ein einziges Mal angezeigt (gespeichert wird nur ein
   SHA-256-Hash). Geht er verloren, einfach einen neuen erstellen und den alten
   widerrufen.

Der Token gehört im HTTP-Header hinter `Bearer ` – der vollständige
Header-Wert ist also `Bearer zw_pat_…`.

## Schritt 2 – Meter-ID (UUID) herausfinden

Öffne den Zähler in Zählwerk (**Zählwerk → Zähler**). Die UUID steht in der
Adresszeile: `/zaehler/<meterId>`. Genau diese `meterId` gehört in den Payload.

## Schritt 3 – Weg wählen

- **Der Zählerstand liegt bereits als Sensor in Home Assistant vor**
  (z. B. über die Tasmota-/ESPHome-/Shelly-Integration, DSMR, ein Modbus-Gerät …):
  → nutze den [Blueprint](#weg-a--home-assistant-blueprint-empfohlen). Ein Klick,
  Sensor + Meter-ID auswählen, fertig.
- **Das Gerät soll direkt senden**, ohne den Umweg über HA:
  → nutze die passende [Gerätevorlage](#weg-b--gerät-sendet-direkt).

---

## Weg A – Home Assistant Blueprint (empfohlen)

### 1. `rest_command` + Secret anlegen

Übernimm den `rest_command`-Block aus [`configuration.yaml`](./configuration.yaml)
in deine HA-`configuration.yaml` und trage in `secrets.yaml` ein:

```yaml
# secrets.yaml
zaehlwerk_url: "https://dein-portal.example/api/v1/readings"
zaehlwerk_auth: "Bearer zw_pat_dein_echter_token"
```

Danach **Entwicklerwerkzeuge → YAML → Konfiguration prüfen**, dann HA neu laden.

### 2. Blueprint importieren

In Home Assistant: **Einstellungen → Automatisierungen & Szenen → Blueprints →
Blueprint importieren** und die Roh-URL der Datei
[`blueprints/zaehlwerk_push_reading.yaml`](./blueprints/zaehlwerk_push_reading.yaml)
einfügen (in GitHub auf **Raw** klicken und die URL kopieren).

Alternativ die Datei nach `config/blueprints/automation/zaehlwerk/` kopieren.

### 3. Automation erstellen

Aus dem Blueprint eine Automation anlegen und ausfüllen:

- **Zähler-Sensor** – der HA-Sensor mit dem aktuellen Zählerstand.
- **Zählwerk Meter-ID** – die UUID aus Schritt 2.
- **Übertragungszeit** – z. B. `23:55:00` (täglich). Optional zusätzlich bei
  jeder Sensoränderung senden.

Fertig. Ab jetzt landet jeder Zählerstand automatisch in Zählwerk.

---

## Weg B – Gerät sendet direkt

Wenn dein Messgerät selbst HTTP sprechen kann, braucht es Home Assistant gar
nicht als Zwischenschritt. Vorlagen im Ordner [`devices/`](./devices):

- **ESPHome** – [`devices/esphome.yaml`](./devices/esphome.yaml): `http_request`
  + `interval`, sendet den Zählerstand z. B. alle 6 h.
- **Tasmota** – [`devices/tasmota-rule.txt`](./devices/tasmota-rule.txt): eine
  Regel mit `WebQuery`, getriggert per `Rule`/`Timer`.
- **Shelly (Gen2/Plus/Pro)** – [`devices/shelly-script.js`](./devices/shelly-script.js):
  ein Skript, das per `Shelly.call("HTTP.POST", …)` sendet.

Trage in jeder Vorlage **Portal-URL, Meter-ID und Token** an den markierten
Stellen ein.

---

## Testen

Ein einzelner Testaufruf von der Kommandozeile (Werte anpassen):

```sh
curl -X POST "https://dein-portal.example/api/v1/readings" \
  -H "Authorization: Bearer zw_pat_dein_token" \
  -H "Content-Type: application/json" \
  -d '{"meterId":"00000000-0000-0000-0000-000000000000","value":1234.56}'
```

Erfolg (`201`):

```json
{
  "ok": true,
  "reading": { "id": "…", "meterId": "…", "value": 1234.56, "timestamp": "…", "source": "api" },
  "consumption": { "amount": 12.3, "amountPerDay": 4.1, "days": 3, "unit": "kWh", "implausible": false }
}
```

## Fehlerbehebung

| Status | Bedeutung | Lösung |
| --- | --- | --- |
| `401 Unauthorized` | Token fehlt/ungültig | Header muss exakt `Bearer zw_pat_…` sein; Token evtl. abgelaufen/widerrufen – neuen erstellen. |
| `404 Zähler nicht gefunden` | `meterId` stimmt nicht | UUID aus der Zähler-URL erneut kopieren. |
| `400 Ungültige Eingabe` | Payload-Fehler | `value` muss eine positive Zahl sein; JSON prüfen. Details stehen im `issues`-Feld der Antwort. |
| `422 Unplausibler Zählerstand` | Wert kleiner als vorher | Bei Zählertausch `zaehlerGetauscht: true` + `startwertNeu` senden, sonst einmalig `allowImplausible: true`. |
| `429 Zu viele Anfragen` | Rate-Limit (120/min pro IP) | Sende-Intervall vergrößern; `Retry-After`-Header beachten. |

Der Endpunkt akzeptiert zusätzlich eine gültige Web-Session – für automatisierte
Geräte ist der PAT der richtige Weg.
