// Logical grouping + colouring of datalog channels. MGflasher logs expose dozens
// of raw columns; grouping them (Boost Control, Ignition & Knock, Fueling, …)
// makes the analyzer's toggles navigable and gives each channel a stable colour.
//
// Pure data + matching only — safe to import from Server, Client and tests.

export interface ParameterGroup {
  id: string;
  label: string;
  /** Base hue for channels in this group; individual series vary lightness. */
  color: string;
  /** Ordered matchers (case-insensitive) that assign a header to this group. */
  match: RegExp[];
}

// Order matters: the first group whose matcher hits wins. "Other" is the
// implicit fallback and is not listed here.
export const PARAMETER_GROUPS: ParameterGroup[] = [
  {
    id: "boost",
    label: "Boost Control",
    color: "#fd7e14",
    match: [/boost/i, /wgdc/i, /\bwg\b/i, /wastegate/i, /ladedruck/i, /charge\s*air/i, /\bmaf\b/i, /mass\s*air/i, /compressor/i, /spool/i],
  },
  {
    id: "ignition",
    label: "Ignition & Knock",
    color: "#fa5252",
    match: [/ign(ition)?/i, /timing/i, /z(ü|ue)nd/i, /knock/i, /klopf/i, /correction/i],
  },
  {
    id: "fueling",
    label: "Fueling",
    color: "#4dabf7",
    match: [
      /hpfp/i,
      /lpfp/i,
      /fuel/i,
      /rail/i,
      /afr/i,
      /lambda/i,
      /stft/i,
      /ltft/i,
      /trim/i,
      /injection/i,
      /einspritz/i,
    ],
  },
  {
    id: "engine",
    label: "Engine & Drivetrain",
    color: "#20c997",
    match: [
      /rpm/i,
      /drehzahl/i,
      /load/i,
      /last/i,
      /throttle/i,
      /drossel/i,
      /pedal/i,
      /gear/i,
      /gang/i,
      /speed/i,
      /geschwindigkeit/i,
    ],
  },
  {
    id: "temps",
    label: "Temperatures",
    color: "#f783ac",
    match: [/iat/i, /temp/i, /coolant/i, /k(ü|ue)hl/i, /oil/i, /(ö|oe)l/i, /ambient/i],
  },
];

// Every column that matches no known group lands here — nothing is dropped or
// whitelisted away, so custom/rare channels stay fully selectable.
const OTHER_GROUP = { id: "other", label: "Sonstige / Custom", color: "#868e96" } as const;

/** All groups including the "Other" fallback, in display order. */
export const ALL_GROUPS = [
  ...PARAMETER_GROUPS.map((g) => ({ id: g.id, label: g.label, color: g.color })),
  OTHER_GROUP,
];

/** The group a raw channel label belongs to. Falls back to "Other". */
export function groupForLabel(label: string): { id: string; label: string; color: string } {
  for (const group of PARAMETER_GROUPS) {
    if (group.match.some((re) => re.test(label))) {
      return { id: group.id, label: group.label, color: group.color };
    }
  }
  return OTHER_GROUP;
}

// A small deterministic palette per group so co-plotted channels of the same
// group stay visually distinct instead of all sharing one hue.
const SHADES: Record<string, string[]> = {
  boost: ["#fd7e14", "#e8590c", "#ffa94d", "#d9480f"],
  ignition: ["#fa5252", "#e03131", "#ff8787", "#c92a2a"],
  fueling: ["#4dabf7", "#1971c2", "#74c0fc", "#1864ab"],
  engine: ["#20c997", "#0ca678", "#63e6be", "#087f5b"],
  temps: ["#f783ac", "#d6336c", "#faa2c1", "#a61e4d"],
  other: ["#868e96", "#495057", "#adb5bd", "#343a40"],
};

/**
 * Deterministic colour for a channel: chosen from its group's shade ramp by a
 * stable hash of the label, so the same channel keeps its colour across reloads.
 */
export function colorForLabel(label: string, groupId: string): string {
  const ramp = SHADES[groupId] ?? SHADES.other;
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return ramp[Math.abs(hash) % ramp.length];
}
