// Reading real progress out of the BuildKit log.
//
// The four coarse stages (pull → build → migrate → restart) are honest but
// useless while the build runs, and the build IS the long phase — several
// minutes where the bar sits at 25% and nothing suggests the thing is alive.
// BuildKit already narrates every step it takes; this turns that narration into
// a number.
//
// Lines look like:
//
//   #12 [builder 5/9] RUN pnpm install --frozen-lockfile
//   #12 DONE 41.3s
//   #17 [runner 3/6] COPY --from=builder /app/.next/standalone ./
//   #17 CACHED
//
// The `M/N` inside the brackets is what matters: N is how many steps that image
// stage has, M is where we are. Everything else on the line is detail.
//
// Pure — no fs, no fetch. The caller passes the log tail it already has.

/** One parsed BuildKit step. */
export interface BuildStep {
  /** Image stage name, e.g. "builder", "runner", "internal". */
  stage: string;
  /** 1-based index of this step within its stage. */
  index: number;
  /** How many steps that stage has in total. */
  total: number;
  /** The command, trimmed — what to show as "currently doing". */
  label: string;
}

export interface BuildProgress {
  /** Newest step seen, or null when the build has not announced one yet. */
  current: BuildStep | null;
  /** 0…100 across all stages seen so far, or null when not computable. */
  percent: number | null;
  /** Human summary, e.g. "builder 5/9". */
  summary: string | null;
}

// `#12 [builder 5/9] RUN …` — the leading marker is optional because BuildKit
// omits it in some output modes, and the stage name may contain spaces
// ("internal load build definition") or a platform prefix.
const STEP_LINE = /^#\d+\s+\[([^\]]+?)\s+(\d+)\/(\d+)\]\s*(.*)$/;

// Steps that are pure bookkeeping. Counting them makes the bar lurch forward
// before any real work has happened.
const NOISE_STAGES = new Set(["internal"]);

function parseLine(line: string): BuildStep | null {
  const match = STEP_LINE.exec(line.trim());
  if (!match) return null;
  const [, stage, indexRaw, totalRaw, label] = match;
  const index = Number(indexRaw);
  const total = Number(totalRaw);
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return null;
  if (index < 1 || index > total) return null;
  return { stage: stage.trim(), index, total, label: label.trim() };
}

/**
 * Fold a build log into progress.
 *
 * Progress is measured across every stage the log has ANNOUNCED, not across the
 * whole Dockerfile — BuildKit does not say up front how many stages there will
 * be. So the number only ever describes what is known, and it can therefore
 * step backwards when a new stage appears (5/9 done, then a 6-step stage starts:
 * 55% → 50%). That is honest, and preferable to a bar that reaches 100% and then
 * sits there while the build keeps going.
 */
export function parseBuildProgress(log: string): BuildProgress {
  if (!log) return { current: null, percent: null, summary: null };

  // Highest index reached per stage. BuildKit interleaves stages, and a step can
  // be reported twice (start, then DONE), so max-per-stage is the stable read.
  const reached = new Map<string, { index: number; total: number }>();
  let current: BuildStep | null = null;

  for (const line of log.split("\n")) {
    const step = parseLine(line);
    if (!step) continue;
    if (NOISE_STAGES.has(step.stage)) continue;

    current = step;
    const seen = reached.get(step.stage);
    if (!seen || step.index > seen.index) {
      reached.set(step.stage, { index: step.index, total: step.total });
    }
  }

  if (!current || reached.size === 0) {
    return { current: null, percent: null, summary: null };
  }

  let done = 0;
  let total = 0;
  for (const entry of reached.values()) {
    done += entry.index;
    total += entry.total;
  }

  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  return {
    current,
    percent,
    summary: `${current.stage} ${current.index}/${current.total}`,
  };
}
