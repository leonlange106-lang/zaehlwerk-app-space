// =============================================================================
// Shelly (Gen2 / Plus / Pro) -> Zählwerk (direkter POST, ohne Home Assistant)
// -----------------------------------------------------------------------------
// Gen2-Shellys führen eigene JS-Skripte aus. Dieses Skript sendet den
// Zählerstand in einem festen Intervall an Zählwerk.
//
// Einbinden:  Shelly Web-UI -> Scripts -> Add script -> einfügen -> Save -> Start.
// Drei Stellen anpessen: PORTAL_URL, TOKEN, METER_ID – und readMeterValue().
// =============================================================================

let PORTAL_URL = "https://dein-portal.example/api/v1/readings"; // <<< Portal-URL >>>
let TOKEN = "zw_pat_dein_token"; // <<< PAT (ohne "Bearer ") >>>
let METER_ID = "00000000-0000-0000-0000-000000000000"; // <<< Meter-ID (UUID) >>>
let INTERVAL_MS = 15 * 60 * 1000; // alle 15 Minuten

// Zählerstand ermitteln. Bei einem Shelly Pro EM/3EM z. B. die aufsummierte
// Gesamtenergie. Passe dies an dein Modell an (siehe Shelly.getComponentStatus).
function readMeterValue() {
  // Beispiel Pro EM (Kanal 0), aktive Gesamtenergie in Wh -> kWh:
  let em = Shelly.getComponentStatus("em1data:0");
  if (em && typeof em.total_act_energy === "number") {
    return em.total_act_energy / 1000;
  }
  return null; // nichts senden, wenn kein Wert vorliegt
}

function pushReading() {
  let value = readMeterValue();
  if (value === null) {
    print("Zählwerk: kein Messwert – überspringe.");
    return;
  }

  Shelly.call(
    "HTTP.POST",
    {
      url: PORTAL_URL,
      timeout: 10,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + TOKEN,
      },
      body: JSON.stringify({ meterId: METER_ID, value: value }),
    },
    function (result, errCode, errMsg) {
      if (errCode !== 0) {
        print("Zählwerk POST fehlgeschlagen: " + errMsg);
      } else {
        print("Zählwerk POST -> HTTP " + result.code);
      }
    }
  );
}

// Direkt einmal senden, dann im Intervall.
pushReading();
Timer.set(INTERVAL_MS, true, pushReading);
