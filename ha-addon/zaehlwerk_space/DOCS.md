# Zählwerk App Space — Home-Assistant-Add-on

Ein dünner nginx-Reverse-Proxy vor der App, die in einer eigenen LXC läuft.
**Seit 2.0.0 leitet er nur weiter** — er formt keine Sicherheitskopfzeilen mehr um.

## Warum das eine Änderung wert war

Bis 1.1.0 schrieb dieses Add-on die Content-Security-Policy der App neu und hielt
dafür eine vollständige Kopie der Policy in seiner nginx-Konfiguration, mit dem
Hinweis, beide „in sync" zu halten. Das ist der Grund, aus dem
`RELEASE-3.0.0.md` § 4 vorschlug, das Add-on abzuschaffen.

Der Fehler ist nicht theoretisch: Ändert die App ihre Policy, merkt der Proxy
davon nichts und legt weiter die alte darüber. **Eine veraltete Sicherheitsregel
über eine aktuelle gelegt schwächt sie, ohne dass es auffällt** — sie wird ja
ausgeliefert, nur eben die falsche.

Jetzt entscheidet die App das selbst, dort wo sie es ohnehin weiß.

## Einrichtung

**1 — Die App muss einbettbar gebaut sein.** Das ist ein BUILD-Argument, keine
Laufzeitvariable: die Policy wird beim Bauen festgeschrieben. In der `.env` der
App-Instanz:

```env
# Ingress (die App läuft unter HAs eigener Herkunft):
HA_INGRESS=true

# ODER panel_iframe auf festem Port (fremde Herkunft — HAs Adresse eintragen):
FRAME_ANCESTORS=http://192.168.1.43:8123
```

Dann dort `docker compose -f docker-compose.prod.yml up -d --build`.

**2 — Add-on konfigurieren.** Nur noch eine Option:

```yaml
backend_url: "http://192.168.1.50:3000"
```

Die Adresse der App-Instanz. Beachte: läuft die App hinter TLS mit *lokal*
ausgestelltem Zertifikat, nimm hier den HTTP-Weg — nginx kennt diese CA nicht.

## Zwei Wege, und ihr ehrlicher Stand

### panel_iframe (funktioniert)

Das Add-on stellt den Proxy auf einem festen Port bereit (Standard 8099). In der
HA-Konfiguration ein `panel_iframe` darauf zeigen lassen. Kein Pfad-Problem.

Voraussetzung: `FRAME_ANCESTORS` auf HAs Herkunft, siehe oben.

### Ingress (noch nicht vollständig)

„Open Web UI" nutzt HAs Ingress, das die App unter einem dynamischen Unterpfad
ausliefert (`/api/hassio_ingress/<token>/`). **Next.js verweist auf seine
Bausteine mit absoluten Pfaden** (`/_next/…`), die der Browser gegen die Wurzel
von HAs Herkunft auflöst — also am Unterpfad vorbei, mit 404 als Ergebnis.

Das ist keine Nachlässigkeit dieses Add-ons, sondern eine echte Grenze: Next
kennt `basePath` nur als Konstante zur Bauzeit, und der Ingress-Token steht erst
zur Laufzeit fest.

Das Add-on reicht `X-Ingress-Path` inzwischen an die App durch — die Grundlage
für eine Lösung, aber die Lösung selbst fehlt noch. Wer heute eine verlässliche
Einbettung will, nimmt `panel_iframe`.
