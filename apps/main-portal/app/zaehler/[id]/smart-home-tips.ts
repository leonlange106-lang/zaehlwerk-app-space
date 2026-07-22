import type { EnergyCategoryValue } from "@zaehlwerk/database/shared";

export interface SmartHomeTip {
  title: string;
  description: string;
}

const COMMON_TIP: SmartHomeTip = {
  title: "MQTT",
  description:
    "Beliebiges Funk-/ESPHome-Zusatzmodul sendet Zählerstände per MQTT — ideal für Impulsausgänge an Hutschienenzählern.",
};

const AI_OCR_TIP: SmartHomeTip = {
  title: "AI-OCR per Kamera",
  description:
    "ESP32-Cam (oder vorhandene IP-Kamera) fotografiert das Ziffernblatt periodisch; ein OCR-Dienst liest den Stand automatisch aus — nützlich, wenn der Zähler keine digitale Schnittstelle hat.",
};

const TIPS_BY_CATEGORY: Record<EnergyCategoryValue, SmartHomeTip[]> = {
  STROM: [
    {
      title: "Tibber Pulse",
      description:
        "IR-Lesekopf am Stromzähler überträgt den Verbrauch minutengenau — lässt sich per Tibber-API direkt in dieses Portal einspeisen.",
    },
    {
      title: "Shelly 3EM / MQTT",
      description: "Lokale Messung an der Unterverteilung, Verbrauch per MQTT direkt anbinden.",
    },
    AI_OCR_TIP,
  ],
  GAS: [AI_OCR_TIP, COMMON_TIP],
  WASSER: [AI_OCR_TIP, COMMON_TIP],
  PV_ERZEUGUNG: [
    {
      title: "Wechselrichter-API",
      description:
        "Fronius, SMA oder Growatt bieten lokale APIs für Erzeugungsdaten — direkter Import ohne zusätzliche Hardware.",
    },
    COMMON_TIP,
  ],
  PV_EINSPEISUNG: [
    {
      title: "Tibber Pulse",
      description: "Funktioniert auch am Einspeisezähler, sofern dieser eine IR-Schnittstelle hat.",
    },
    COMMON_TIP,
  ],
  CUSTOM: [COMMON_TIP, AI_OCR_TIP],
};

export function getSmartHomeTips(kategorie: EnergyCategoryValue): SmartHomeTip[] {
  return TIPS_BY_CATEGORY[kategorie];
}
