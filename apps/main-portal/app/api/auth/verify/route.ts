import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "../../../lib/auth-helpers";
import { resolveTwoFactorGate } from "../../../lib/two-factor-policy";
import { forbiddenProblem, unauthorizedProblem } from "../../../lib/api-problem";

// Prüfstelle für Forward-Auth am Reverse Proxy.
//
// Der Proxy stellt vor jeder Anfrage genau eine Frage — "darf der hier rein?" —
// und leitet nur bei 2xx weiter. Die Antwort-Header dieses Endpunkts landen
// dann in der Anfrage nach oben, sodass der Dienst dahinter den geprüften
// Benutzer bekommt, ohne selbst zu authentifizieren.
//
// WARUM DAS HIER UND NICHT IM EDGE-GUARD STEHT: `proxy.ts` läuft auf der
// Edge-Runtime und hat keine Datenbank. Es kann deshalb nur das JWT lesen —
// einen Schnappschuss vom Anmeldezeitpunkt. Genau deswegen ist die 2FA-Pflicht
// dort bewusst NICHT durchgesetzt. Diese Route läuft in Node, fragt live nach
// und schließt damit die Lücke, statt sie über die Dienstgrenze mitzunehmen.
//
// WARUM UNTER /api/auth/: Der Pfad steht in `PUBLIC_API_PREFIXES`, ist also vom
// Edge-Guard ausgenommen — und das muss er sein, sonst prüfte die Prüfstelle
// sich selbst und der Proxy liefe in eine Schleife. Der statische Abschnitt
// `verify` hat in Next Vorrang vor dem `[...nextauth]`-Catch-all daneben; die
// Auth.js-Routen bleiben unberührt.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wohin der Browser zurückgeschickt wird.
 *
 * NICHT aus `request.url` bauen: Der Proxy spricht den Dienst über den
 * Container-Namen an, die Anfrage kommt hier also als `http://main-portal:3000/…`
 * an. Eine daraus gebaute Weiterleitung schickte den Browser an eine Adresse,
 * die es für ihn nicht gibt. Der öffentliche Name steht in den
 * `X-Forwarded-*`-Headern, die Caddy ohnehin setzt.
 */
function publicOrigin(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (proto && host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}

/**
 * Der ursprünglich angefragte Pfad — nicht der dieses Endpunkts.
 *
 * Caddy schickt ihn als `X-Forwarded-Uri` mit. Ohne ihn wüsste die Prüfstelle
 * nur, dass jemand `/api/auth/verify` aufgerufen hat, und könnte weder die
 * Antwortart wählen noch nach der Anmeldung zurückschicken.
 */
function originalUri(request: NextRequest): string {
  const uri = request.headers.get("x-forwarded-uri");
  if (!uri || !uri.startsWith("/")) return "/";
  // Kein Protokoll-relatives "//host" durchlassen: als callbackUrl wäre das
  // eine offene Weiterleitung auf eine fremde Domain.
  if (uri.startsWith("//")) return "/";
  return uri;
}

/**
 * Bekommt der Aufrufer JSON oder eine Weiterleitung?
 *
 * Caddy reicht die Antwort dieses Endpunkts unverändert an den Aufrufer durch.
 * Ein Browser, der auf eine Seite navigiert, soll auf `/login` landen; ein
 * Skript soll `401 application/problem+json` bekommen und nicht das HTML der
 * Anmeldeseite, das es nicht lesen kann.
 */
function wantsJson(request: NextRequest, uri: string): boolean {
  if (uri.startsWith("/api/")) return true;
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("application/json")) return true;
  // Eine echte Seitennavigation sagt das von sich aus. Fehlt der Header (curl,
  // ältere Clients), entscheidet oben schon der Pfad bzw. `Accept`.
  const mode = request.headers.get("sec-fetch-mode");
  if (mode && mode !== "navigate") return true;
  return false;
}

export async function GET(request: NextRequest) {
  const uri = originalUri(request);
  const json = wantsJson(request, uri);

  // Eine Autorisierungsentscheidung darf NIE zwischengespeichert werden — weder
  // vom Proxy noch von einem Browser. Sonst überlebt ein "darf rein" den
  // Rechteentzug, und das ist genau die Eigenschaft, wegen der diese Prüfstelle
  // überhaupt existiert.
  const noStore = { "Cache-Control": "no-store, private" };

  const user = await getSessionUser();

  if (!user) {
    if (json) {
      const res = unauthorizedProblem();
      res.headers.set("Cache-Control", noStore["Cache-Control"]);
      return res;
    }
    const login = new URL("/login", publicOrigin(request));
    login.searchParams.set("callbackUrl", uri);
    return NextResponse.redirect(login, { status: 302, headers: noStore });
  }

  // Die Prüfung, die der Edge-Guard nicht leisten kann. Sie liest den
  // Instanz-Schalter und den Zustand des Kontos live, greift also sofort und
  // nicht erst beim nächsten Anmelden.
  const gate = await resolveTwoFactorGate({ id: user.id });
  if (gate.blocked) {
    if (json) {
      const res = forbiddenProblem(
        "Für dieses Konto ist ein zweiter Faktor erforderlich. Bitte in der Oberfläche einrichten.",
      );
      res.headers.set("Cache-Control", noStore["Cache-Control"]);
      return res;
    }
    // Auf die Startseite, nicht auf /login: Die Sitzung ist gültig, es fehlt der
    // Faktor — und das Einrichtungsfenster rendert das Root-Layout anstelle des
    // Inhalts. Eine Weiterleitung auf /login sähe wie ein abgelaufener Login aus
    // und schickte den Nutzer in eine Runde, die nichts ändert.
    return NextResponse.redirect(new URL("/", publicOrigin(request)), {
      status: 302,
      headers: noStore,
    });
  }

  // Erst hier, und nur hier, werden die Header gesetzt. Der Proxy löscht
  // mitgebrachte `X-Auth-*` vor der Prüfung und kopiert ausschließlich diese
  // drei aus der Antwort — deshalb ist eine 200 ohne Header keine harmlose
  // Auslassung, sondern eine Anfrage ohne Absender.
  //
  // ERWEITERUNG (ADR 0003, Stufe 2): Hier kommt die App-Freigabe dazu. Der Proxy
  // übergibt dann, welche App gemeint ist, und diese Stelle antwortet 403 bzw.
  // leitet auf den Launcher um, wenn `allowedApps` sie nicht enthält. Bewusst
  // noch nicht gebaut: Der Probeaufbau soll erst die Kette beweisen.
  return new NextResponse(null, {
    status: 200,
    headers: {
      ...noStore,
      "X-Auth-User-Id": user.id,
      "X-Auth-User-Email": user.email,
      "X-Auth-Role": user.role,
    },
  });
}
