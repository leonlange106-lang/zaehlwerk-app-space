# Fehlerformat der API

Alle Fehler unter `/api/v1` antworten nach [RFC 9457 — Problem Details for HTTP
APIs](https://www.rfc-editor.org/rfc/rfc9457.html), mit
`Content-Type: application/problem+json`.

Vorher hatte fast jede Route ihre eigene Form: mal `{ error }`, mal
`{ success: false, error }`, mal `{ error, knownObisCodes }`. Wer eine
Integration schrieb, musste für jeden Endpunkt neu herausfinden, wo die
Begründung steht — und schrieb am Ende `err.error ?? err.message ?? "?"`.

## Aufbau

```json
{
  "type": "https://github.com/leonlange106-lang/zaehlwerk-app-space/blob/main/docs/api/errors.md#validation-error",
  "title": "Ungültige Eingabe",
  "status": 400,
  "detail": "meterId muss eine gültige UUID sein.",
  "error": "meterId muss eine gültige UUID sein.",
  "errors": [{ "field": "meterId", "message": "meterId muss eine gültige UUID sein." }]
}
```

| Feld | Bedeutung |
|---|---|
| `type` | Kennung der Fehlerart. Ein URI, keine abrufbare Seite — der Anker unten in diesem Dokument beschreibt sie. |
| `title` | Kurzform der Art, unabhängig vom Einzelfall. |
| `status` | Derselbe Wert wie der HTTP-Status. |
| `detail` | Was in diesem Fall schiefging. Der Satz, den ein Mensch liest. |
| `error` | **Veraltet.** Derselbe Text wie `detail`. Siehe unten. |

## Verträglichkeit

`error` steht weiterhin in jeder Fehlerantwort, mit demselben Text wie `detail`.

Das ist kein Zögern, sondern Absicht: Draußen laufen Automationen, die genau
dieses Feld lesen. Ein Feld wegzunehmen, dessen Verschwinden erst beim nächsten
Fehler auffällt, ist die unfreundlichste Art, eine API zu verbessern — der Bruch
zeigt sich dann, wenn ohnehin schon etwas schiefgeht.

Dasselbe gilt für zwei ältere Felder an den Stellen, an denen es sie schon gab:

- `issues` (`POST /api/v1/readings`) — dieselben Angaben wie `errors`, aber mit
  `path` statt `field`.
- `success: false` (`POST /api/v1/logs/ingest`) — die Skripte dort prüfen
  häufig nur dieses Feld.

Neuer Code liest `detail` und `errors`. Eine Frist für die alten Felder ist
nicht gesetzt; sie wird hier angekündigt, bevor sie beginnt.

## Fehlerarten

### `unauthorized` — 401

Kein gültiger Zugang. Entweder anmelden (Cookie-Sitzung) oder ein Personal
Access Token als `Authorization: Bearer zw_pat_…` senden.

### `forbidden` — 403

Angemeldet, aber ohne die nötigen Rechte — meist eine Aktion, die
Administratoren vorbehalten ist.

### `not-found` — 404

Die angesprochene Sache gibt es nicht. `detail` nennt sie beim Namen.

### `validation-error` — 400

Die Anfrage ist formal falsch: fehlendes Feld, falscher Typ, unbekannter Wert.

Erweiterungsfelder:

- `errors` — Liste aus `{ field, message }`, **alle** Fehler, nicht nur der
  erste. Wer drei Felder falsch gefüllt hat, soll das in einer Runde erfahren.
- `knownObisCodes` — nur bei einer unbekannten OBIS-Kennziffer: die Liste der
  gültigen. Der Unterschied zwischen „falsch" und „falsch, und hier stehen die
  richtigen".

### `rate-limited` — 429

Zu viele Anfragen. Immer mit `Retry-After` (Sekunden) als Kopfzeile **und** als
Feld `retryAfter` — ohne die Angabe rät der Aufrufer, und ein Gerät, das rät,
probiert es in einer Sekunde wieder und verlängert die Sperre.

### `unprocessable` — 422

Formal gültig, inhaltlich abgelehnt. Der Hauptfall ist ein unplausibler
Zählerstand: Der Verbrauch seit der vorherigen Ablesung wäre negativ.

Erweiterungsfeld `plausibility` mit `from`, `to`, `value` und `register`.

Auflösen lässt sich das auf zwei Wegen:

- War es ein Zählertausch, `zaehlerGetauscht: true` und `startwertNeu` senden.
- War der Stand wirklich so, `allowImplausible: true` senden.

### `payload-too-large` — 413

Der Body überschreitet die Grenze des Endpunkts. Erweiterungsfeld `maxBytes`.

### `conflict` — 409

Der Zustand auf dem Server verträgt sich nicht mit der Anfrage.

### `internal-error` — 500

Unerwarteter Fehler. `detail` bleibt bewusst allgemein — eine Ausnahme nach
außen zu reichen, verrät Pfade und Bibliotheksversionen. Die Einzelheiten stehen
im Server-Log, wo der Betreiber sie sieht und der Aufrufer nicht.

## Beispiel: Fehler auswerten

```bash
curl -sS -X POST https://dein-portal.example/api/v1/readings \
  -H "Authorization: Bearer zw_pat_…" \
  -H "Content-Type: application/json" \
  -d '{"meterId":"…","value":-5}' \
  | jq -r '.detail, (.errors[]? | "  \(.field): \(.message)")'
```
