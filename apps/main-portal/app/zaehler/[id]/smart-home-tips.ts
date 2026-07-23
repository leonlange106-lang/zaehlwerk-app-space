import type { EnergyCategoryValue } from "@zaehlwerk/database/shared";

export interface SmartHomeTip {
  title: string;
  description: string;
  /** Optionaler Link zu Projekt/Doku/Produkt (wird als externer Link gerendert). */
  link?: string;
}

const AI_ON_THE_EDGE_TIP: SmartHomeTip = {
  title: "AI-on-the-edge-device (ESP32-Cam)",
  description:
    "Ein günstiges ESP32-Cam-Modul fotografiert das mechanische Zählwerk und liest die Ziffern per On-Device-OCR aus. Der Stand wird per MQTT oder REST übertragen — die Standardlösung für Zähler ohne digitale Schnittstelle.",
  link: "https://github.com/jomjol/AI-on-the-edge-device",
};

const MQTT_IMPULSE_TIP: SmartHomeTip = {
  title: "Impulsausgang → ESPHome/Tasmota",
  description:
    "Viele Hutschienen-/Balgengaszähler haben einen S0-Impuls- oder Reed-Kontakt-Ausgang. Ein ESPHome- oder Tasmota-Modul zählt die Impulse und meldet den kumulierten Stand per MQTT.",
};

const HOME_ASSISTANT_TIP: SmartHomeTip = {
  title: "Home Assistant → REST-Automation",
  description:
    "Existiert der Zählerstand bereits als Sensor in Home Assistant, überträgt eine REST-Command-Automation ihn per PAT direkt an dieses Portal. Snippet unten generieren.",
};

const TIPS_BY_CATEGORY: Record<EnergyCategoryValue, SmartHomeTip[]> = {
  STROM: [
    {
      title: "IR-Lesekopf (Tasmota / hichi)",
      description:
        "Moderne eHz-/Smart-Meter mit optischer SML-Schnittstelle: ein aufgesetzter IR-Lesekopf mit Tasmota firmware liest Bezug und Einspeisung sekundengenau aus.",
      link: "https://tasmota.github.io/docs/Smart-Meter-Interface/",
    },
    {
      title: "Shelly EM / 3EM",
      description:
        "Klemmt mit Stromwandlern an der Unterverteilung und misst den Verbrauch direkt — lokale API bzw. MQTT, kein Zugriff aufs Zählwerk nötig.",
      link: "https://www.shelly.com/",
    },
    {
      title: "Tibber Pulse",
      description:
        "IR-Aufsatz für Zähler mit HAN-/Kundenschnittstelle; überträgt den Verbrauch minutengenau und lässt sich per Tibber-API bzw. Home Assistant weiterreichen.",
    },
    HOME_ASSISTANT_TIP,
  ],
  GAS: [MQTT_IMPULSE_TIP, AI_ON_THE_EDGE_TIP, HOME_ASSISTANT_TIP],
  WASSER: [
    AI_ON_THE_EDGE_TIP,
    {
      title: "Reed-Kontakt am Zählwerk",
      description:
        "Wasserzähler mit magnetischer Markierung auf der letzten Ziffer lösen einen Reed-Kontakt aus; ein ESPHome-Modul zählt die Umdrehungen zum Verbrauch hoch.",
    },
    HOME_ASSISTANT_TIP,
  ],
  PV_ERZEUGUNG: [
    {
      title: "Wechselrichter-API",
      description:
        "Fronius (Solar API), SMA (Modbus/Speedwire) oder Growatt bieten lokale Schnittstellen für Erzeugungsdaten — direkter Import ohne zusätzliche Hardware.",
    },
    HOME_ASSISTANT_TIP,
    MQTT_IMPULSE_TIP,
  ],
  PV_EINSPEISUNG: [
    {
      title: "IR-Lesekopf am Zweirichtungszähler",
      description:
        "Der Einspeisezähler (bzw. das Einspeise-Register des Zweirichtungszählers) wird per Tasmota-IR-Lesekopf über die SML-Schnittstelle ausgelesen.",
      link: "https://tasmota.github.io/docs/Smart-Meter-Interface/",
    },
    HOME_ASSISTANT_TIP,
  ],
  CUSTOM: [AI_ON_THE_EDGE_TIP, MQTT_IMPULSE_TIP, HOME_ASSISTANT_TIP],
};

export function getSmartHomeTips(kategorie: EnergyCategoryValue): SmartHomeTip[] {
  return TIPS_BY_CATEGORY[kategorie];
}
