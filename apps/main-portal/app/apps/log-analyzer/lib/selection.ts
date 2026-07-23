import type { LogSeries } from "./types";

// Choosing a sensible default set of channels to plot when a log first opens.
// Showing all 30+ channels at once is noise; these priority patterns surface the
// parameters an ECU tuner reaches for first (RPM, boost target vs. actual,
// timing, knock, fuel pressures). Falls back to the first few channels.

const PRIORITY: RegExp[] = [
  /rpm|drehzahl/i,
  /boost\s*actual|boost\s*ist/i,
  /boost\s*target|boost\s*soll/i,
  /ign(ition)?\s*timing|z(ü|ue)nd/i,
  /knock|klopf|correction/i,
  /hpfp/i,
];

const MAX_DEFAULT = 6;

/** Keys to pre-select for a freshly opened log. */
export function defaultSelection(series: LogSeries[]): string[] {
  const picked: string[] = [];
  for (const re of PRIORITY) {
    const hit = series.find((s) => re.test(s.label) && !picked.includes(s.key));
    if (hit) picked.push(hit.key);
    if (picked.length >= MAX_DEFAULT) break;
  }
  if (picked.length === 0) {
    return series.slice(0, Math.min(4, series.length)).map((s) => s.key);
  }
  return picked;
}
