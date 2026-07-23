// MGflasher exports carry the drive time (and often the tune stage + octane) in
// the filename, e.g. "2026-07-20_22_37_14_Stage1_100RON_2.1_CS102258_SM9977" or
// "20260712_17_23_23_Stage1_100RON_...". Parsing it lets the overview sort logs
// by when they were actually driven (not when uploaded) and pre-fill the octane
// tag. Pure + framework-free so it can be shared and unit-tested.

export interface ParsedFilename {
  /** Drive timestamp parsed from the name (UTC), or null. */
  recordedAt: Date | null;
  /** Tune stage, e.g. "Stage 1", or null. */
  stage: string | null;
  /** Octane / fuel, e.g. "100 RON" or "E85", or null. */
  octane: string | null;
}

// yyyy[-]mm[-]dd <sep> HH[:._-]MM[:._-]SS — tolerates dashed or compact dates and
// underscore/colon/dot/dash time separators.
const TS_RE =
  /(\d{4})-?(\d{2})-?(\d{2})[_\- ](\d{2})[_.:\-](\d{2})[_.:\-](\d{2})/;

function parseTimestamp(name: string): Date | null {
  const m = TS_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return Number.isNaN(date.getTime()) ? null : date;
}

// Split into tokens on the usual separators. \b anchors are unreliable here
// because the separator is often "_", which regex treats as a word char (so
// "Stage1_100RON" has no boundary after the digit) — tokenizing sidesteps that.
function tokenize(name: string): string[] {
  return name
    .replace(/\.[^.]+$/, "") // drop extension
    .split(/[_\-.\s]+/)
    .filter(Boolean);
}

function parseStage(tokens: string[]): string | null {
  for (const t of tokens) {
    const m = /^stage(\d)$/i.exec(t);
    if (m) return `Stage ${m[1]}`;
  }
  return null;
}

function parseOctane(tokens: string[]): string | null {
  for (const t of tokens) {
    const ron = /^(\d{2,3})ron$/i.exec(t);
    if (ron) return `${ron[1]} RON`;
    const e = /^E(85|30|20|10|98)$/i.exec(t);
    if (e) return `E${e[1]}`;
  }
  return null;
}

export function parseLogFilename(name: string): ParsedFilename {
  const tokens = tokenize(name);
  return {
    recordedAt: parseTimestamp(name),
    stage: parseStage(tokens),
    octane: parseOctane(tokens),
  };
}
