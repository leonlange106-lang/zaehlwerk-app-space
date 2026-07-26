// Zugriffszahlen von Cloudflare — gemessen an der Kante, VOR der Anwendung.
//
// Das ist der Unterschied zu allem anderen im Admin-Bereich: die App sieht nur,
// was bis zu ihr durchkommt. Was Cloudflare Access abgewiesen, die WAF blockiert
// oder der Cache direkt beantwortet hat, taucht in keinem Server-Log auf. Genau
// diese Zahlen sind die interessanten, wenn man wissen will, wer anklopft.
//
// **GraphQL, nicht REST.** Cloudflare fuehrt Analytics ausschliesslich ueber
// `/client/v4/graphql`; die REST-Endpunkte dafuer sind seit Jahren abgekuendigt.
//
// **Der Token ist ein eigener.** Nicht der Tunnel-Token (der kann nur Tunnel)
// und nicht der GitHub-Token. Er braucht `Analytics: Read` auf der Zone. Fehlt
// er, liefert dieses Modul `null` statt zu werfen — der Bereich zeigt dann eine
// Anleitung statt einer Fehlerseite, denn eine Instanz ohne Cloudflare ist ein
// voellig normaler Betriebsfall.

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

/** Abbruch, bevor eine langsame Antwort einen Renderpfad blockiert. */
const TIMEOUT_MS = 8000;

export interface TrafficPoint {
  /** ISO-Datum (Tagesgranularitaet). */
  date: string;
  requests: number;
  pageViews: number;
  bytes: number;
  threats: number;
}

export interface CountryCount {
  country: string;
  requests: number;
}

export interface TrafficSummary {
  zone: string;
  since: string;
  until: string;
  totals: { requests: number; pageViews: number; bytes: number; threats: number; uniques: number };
  daily: TrafficPoint[];
  topCountries: CountryCount[];
}

/** Warum keine Daten da sind — die UI soll das benennen koennen, nicht raten. */
export type TrafficUnavailable =
  | { reason: "not-configured" }
  | { reason: "error"; message: string };

export type TrafficResult = { ok: true; data: TrafficSummary } | ({ ok: false } & TrafficUnavailable);

function isConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_ANALYTICS_TOKEN && process.env.CLOUDFLARE_ZONE_ID);
}

const QUERY = `
query Traffic($zoneTag: String!, $since: Date!, $until: Date!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequests1dGroups(
        limit: 60
        filter: { date_geq: $since, date_leq: $until }
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        sum {
          requests
          pageViews
          bytes
          threats
          countryMap { clientCountryName requests }
        }
        uniq { uniques }
      }
    }
  }
}`;

interface RawGroup {
  dimensions: { date: string };
  sum: {
    requests: number;
    pageViews: number;
    bytes: number;
    threats: number;
    countryMap: { clientCountryName: string; requests: number }[];
  };
  uniq: { uniques: number };
}

/**
 * Verkehr der letzten `days` Tage.
 *
 * Tagesgranularitaet: die feineren Datensaetze (`httpRequests1mGroups`) sind auf
 * kostenpflichtigen Plaenen deutlich weiter zurueck verfuegbar, aber auf dem
 * kostenlosen Plan nur wenige Stunden — eine Ansicht, die je nach Plan etwas
 * anderes zeigt, ist schlechter als eine, die immer dasselbe zeigt.
 */
export async function fetchTraffic(days = 14): Promise<TrafficResult> {
  if (!isConfigured()) return { ok: false, reason: "not-configured" };

  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  const toDate = (d: Date) => d.toISOString().slice(0, 10);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${process.env.CLOUDFLARE_ANALYTICS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          zoneTag: process.env.CLOUDFLARE_ZONE_ID,
          since: toDate(since),
          until: toDate(until),
        },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, reason: "error", message: `Cloudflare antwortete mit ${response.status}.` };
    }

    const body = (await response.json()) as {
      data?: { viewer?: { zones?: { httpRequests1dGroups?: RawGroup[] }[] } };
      errors?: { message: string }[];
    };

    // GraphQL antwortet mit HTTP 200 und einem Fehlerfeld. Das nicht zu pruefen
    // heisst, eine leere Auswertung als "kein Verkehr" zu zeigen — und ein
    // abgelaufener Token saehe dann aus wie eine ruhige Woche.
    if (body.errors?.length) {
      return { ok: false, reason: "error", message: body.errors[0].message };
    }

    const groups = body.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
    const countries = new Map<string, number>();
    const totals = { requests: 0, pageViews: 0, bytes: 0, threats: 0, uniques: 0 };
    const daily: TrafficPoint[] = [];

    for (const group of groups) {
      totals.requests += group.sum.requests;
      totals.pageViews += group.sum.pageViews;
      totals.bytes += group.sum.bytes;
      totals.threats += group.sum.threats;
      totals.uniques += group.uniq.uniques;
      daily.push({
        date: group.dimensions.date,
        requests: group.sum.requests,
        pageViews: group.sum.pageViews,
        bytes: group.sum.bytes,
        threats: group.sum.threats,
      });
      for (const entry of group.sum.countryMap ?? []) {
        countries.set(
          entry.clientCountryName,
          (countries.get(entry.clientCountryName) ?? 0) + entry.requests,
        );
      }
    }

    return {
      ok: true,
      data: {
        zone: process.env.CLOUDFLARE_ZONE_NAME ?? "",
        since: toDate(since),
        until: toDate(until),
        totals,
        daily,
        topCountries: [...countries.entries()]
          .map(([country, requests]) => ({ country, requests }))
          .sort((a, b) => b.requests - a.requests)
          .slice(0, 8),
      },
    };
  } catch (error) {
    const aborted = (error as Error)?.name === "AbortError";
    return {
      ok: false,
      reason: "error",
      message: aborted
        ? "Cloudflare hat nicht rechtzeitig geantwortet."
        : "Die Abfrage an Cloudflare ist fehlgeschlagen.",
    };
  } finally {
    clearTimeout(timer);
  }
}
