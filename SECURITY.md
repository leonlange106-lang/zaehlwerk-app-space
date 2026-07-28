# Sicherheit

Zählwerk ist eine selbstgehostete Anwendung für Verbrauchsdaten und
Fahrzeug-Datenlogs. Sie verwaltet Zugangsdaten, Personal Access Tokens und eine
Datenbank mit personenbeziehbaren Zeitreihen — Meldungen zu Sicherheitslücken
sind willkommen.

## Eine Lücke melden

Bitte **kein öffentliches Issue**. Nutze stattdessen eine der beiden Wege:

- **GitHub Security Advisory** — im Reiter *Security* → *Report a vulnerability*.
  Das ist der bevorzugte Weg: Der Austausch bleibt privat, bis ein Fix bereitsteht.
- **E-Mail** an den Repository-Inhaber, falls dir das lieber ist.

Hilfreich in der Meldung: betroffene Version (steht unter *Einstellungen →
System & Update*), ein Weg zum Nachstellen, und was ein Angreifer damit
erreichen könnte.

## Was du erwarten kannst

Dies ist ein **Ein-Personen-Projekt ohne Bereitschaftsdienst**. Feste Fristen
zu versprechen, die niemand einhalten kann, wäre unehrlich — deshalb hier nur,
was realistisch ist:

- Eingangsbestätigung, sobald jemand die Meldung liest
- Eine Einschätzung, ob es sich um eine Lücke handelt, bevor an einem Fix
  gearbeitet wird
- Nennung in den Release-Notes, sofern gewünscht

## Unterstützte Versionen

Gefixt wird auf dem **aktuellen Stand** von `main`. Ältere Versionen erhalten
keine Rückportierungen; die Anwendung hat eine eingebaute Update-Funktion
(*Einstellungen → System & Update*), und der Weg nach vorn ist der Weg zum Fix.

## Was ausdrücklich keine Lücke ist

Damit niemand Zeit in Meldungen steckt, die bekannt und beabsichtigt sind:

- **Die App ohne vorgelagerte Absicherung öffentlich erreichbar.** Sie ist für
  den Betrieb hinter Cloudflare Access, einem Reverse Proxy oder im LAN gebaut.
  `DEPLOYMENT.md` beschreibt das.
- **`http://` statt `https://`.** Wird unterstützt, damit eine LXC im LAN ohne
  Zertifikat läuft. Session-Cookies richten sich dabei nach der Verbindung
  (`isSecureConnection()`), nicht nach `NODE_ENV`.
- **Ein Administrator kann alles.** Rollen trennen Nutzer von Administratoren,
  nicht Administratoren voneinander.
- **`DISABLE_2FA_ENFORCEMENT=1`** hebt den 2FA-Zwang auf. Das ist der
  dokumentierte Notausgang bei Aussperrung und setzt Zugriff auf die
  Container-Umgebung voraus — wer den hat, hat ohnehin die Datenbank.

## Was besonders interessiert

Stellen, an denen ein Fehler hier real weh tut:

- **Umgehung des Edge-Guards** (`proxy.ts`) — Zugriff auf eine API-Route ohne
  Sitzung oder gültigen Schlüssel
- **Fremde Daten sehen** trotz fehlender App-Freigabe (`allowedApps`)
- **Umgehung des zweiten Faktors** oder der instanzweiten 2FA-Pflicht
- **Deploy-Endpunkte** (`/api/update/trigger`, `/api/update/rollback`) — sie
  bauen und starten Code; ein nicht validierter Ref wäre Codeausführung
- Auslesen von **Token-Klartext** aus der Datenbank oder den Logs
