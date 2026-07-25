"use client";

import { useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconGitPullRequest,
  IconHistory,
  IconSearch,
} from "@tabler/icons-react";
import type { ChangelogEntry, ChangelogType } from "@zaehlwerk/updater";
import { Badge } from "@/app/components/ui/Badge";
import { TextInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { Alert, Code, IconChip, PageHeader, SegmentedControl } from "@/app/components/ui/primitives";
import classes from "./ChangelogView.module.css";

// Kept local (not imported from @zaehlwerk/updater) so this client bundle never
// pulls in the package's Node-only code — only its TYPES are imported above.
const TYPE_LABELS: Record<ChangelogType, string> = {
  feat: "Feature",
  fix: "Fehlerbehebung",
  perf: "Performance",
  refactor: "Refactoring",
  docs: "Dokumentation",
  chore: "Wartung",
  test: "Tests",
  build: "Build",
  ci: "CI",
  style: "Style",
  revert: "Zurückgenommen",
  other: "Sonstiges",
};

/**
 * Commit-type tints. The label is always spelled out beside the colour — this is
 * a log, and a hue on its own says nothing about what changed.
 */
const TYPE_COLORS: Record<ChangelogType, string> = {
  feat: "var(--zw-ok)",
  fix: "var(--zw-risk)",
  perf: "#a78bfa",
  refactor: "var(--zw-accent-2)",
  docs: "var(--zw-neutral)",
  chore: "var(--zw-neutral)",
  test: "var(--zw-accent)",
  build: "#818cf8",
  ci: "#818cf8",
  style: "#f472b6",
  revert: "var(--zw-watch)",
  other: "var(--zw-neutral)",
};

// Stable display order for the filter chips.
const TYPE_ORDER: ChangelogType[] = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "chore",
  "build",
  "ci",
  "test",
  "style",
  "revert",
  "other",
];

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const GITHUB_PR_BASE = "https://github.com/leonlange106-lang/zaehlwerk-app-space/pull";

type SortOrder = "newest" | "oldest";

/** Filter chip. Tinted in the type's own colour when active, quiet when not. */
function FilterChip({
  active,
  color,
  onToggle,
  children,
}: {
  active: boolean;
  color: string;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className="inline-flex cursor-pointer items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors"
      style={
        active
          ? {
              color,
              borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
            }
          : undefined
      }
    >
      <input type="checkbox" className="sr-only" checked={active} onChange={onToggle} />
      <span className={active ? undefined : "border-line text-dim"}>{children}</span>
    </label>
  );
}

export function ChangelogView({
  entries,
  error,
  currentSha,
}: {
  entries: ChangelogEntry[];
  error: string | null;
  currentSha: string | null;
}) {
  const [search, setSearch] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [breakingOnly, setBreakingOnly] = useState(false);
  const [sort, setSort] = useState<SortOrder>("newest");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Which types actually occur, with counts — drives the filter chips so we
  // never show a chip that would match nothing.
  const typeCounts = useMemo(() => {
    const counts = new Map<ChangelogType, number>();
    for (const entry of entries) {
      counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const availableTypes = TYPE_ORDER.filter((type) => typeCounts.has(type));
  const breakingCount = useMemo(() => entries.filter((entry) => entry.breaking).length, [entries]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const result = entries.filter((entry) => {
      if (selectedTypes.length > 0 && !selectedTypes.includes(entry.type)) return false;
      if (breakingOnly && !entry.breaking) return false;
      if (needle) {
        const haystack = [
          entry.subject,
          entry.body,
          entry.scope ?? "",
          entry.shortSha,
          entry.authorName,
          entry.prNumber ? `#${entry.prNumber}` : "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
    if (sort === "oldest") return [...result].reverse();
    return result;
  }, [entries, search, selectedTypes, breakingOnly, sort]);

  const filtersActive = selectedTypes.length > 0 || breakingOnly || search.trim() !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <IconChip size={36}>
          <IconHistory size={18} stroke={1.7} />
        </IconChip>
        <PageHeader
          title="Changelog"
          description="Alle Änderungen dieser Instanz – filterbar nach Art, Text und mehr."
        />
      </div>

      {error ? (
        <Alert
          tone="risk"
          role="alert"
          icon={<IconAlertTriangle size={16} />}
          title="Changelog nicht verfügbar"
        >
          {error}
          <p className="mt-1 text-xs">
            Meist fehlt oder ist der <Code>GITHUB_TOKEN</Code> abgelaufen (privates Repo). Details
            in DEPLOYMENT.md.
          </p>
        </Alert>
      ) : (
        <>
          <Panel className="[&]:p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative min-w-60 flex-1">
                  <IconSearch
                    size={15}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim"
                  />
                  <TextInput
                    aria-label="Changelog durchsuchen"
                    className="pl-10"
                    placeholder="Suchen (Text, Scope, PR #, SHA, Autor)…"
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                  />
                </div>
                <SegmentedControl
                  className="w-auto min-w-64"
                  label="Sortierung"
                  value={sort}
                  onChange={(value) => setSort(value)}
                  options={[
                    { value: "newest" as SortOrder, label: "Neueste zuerst" },
                    { value: "oldest" as SortOrder, label: "Älteste zuerst" },
                  ]}
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {availableTypes.map((type) => (
                  <FilterChip
                    key={type}
                    active={selectedTypes.includes(type)}
                    color={TYPE_COLORS[type]}
                    onToggle={() =>
                      setSelectedTypes((current) =>
                        current.includes(type)
                          ? current.filter((t) => t !== type)
                          : [...current, type],
                      )
                    }
                  >
                    {TYPE_LABELS[type]} ({typeCounts.get(type)})
                  </FilterChip>
                ))}
                {breakingCount > 0 && (
                  <FilterChip
                    active={breakingOnly}
                    color="var(--zw-risk)"
                    onToggle={() => setBreakingOnly((current) => !current)}
                  >
                    ⚠ Breaking ({breakingCount})
                  </FilterChip>
                )}
              </div>

              <p className="text-xs text-dim">
                {filtered.length} von {entries.length} Einträgen
                {filtersActive && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        setSelectedTypes([]);
                        setBreakingOnly(false);
                      }}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      Filter zurücksetzen
                    </button>
                  </>
                )}
              </p>
            </div>
          </Panel>

          {filtered.length === 0 ? (
            <Panel className="[&]:p-8">
              <p className="text-center text-sm text-dim">Keine Einträge für diese Filter.</p>
            </Panel>
          ) : (
            // A plain list with a drawn spine rather than a timeline component:
            // these are commits, and the only thing the spine has to say is
            // "these are in order".
            <ol className="relative flex flex-col gap-5 border-l border-line pl-6">
              {filtered.map((entry) => {
                const isCurrent = currentSha != null && entry.sha === currentSha;
                const isOpen = expanded[entry.sha] ?? false;
                return (
                  <li key={entry.sha} className="relative">
                    <span
                      aria-hidden
                      className={classes.bullet}
                      data-current={isCurrent || undefined}
                      style={{ background: TYPE_COLORS[entry.type] }}
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
                        style={{
                          color: TYPE_COLORS[entry.type],
                          borderColor: `color-mix(in srgb, ${TYPE_COLORS[entry.type]} 40%, transparent)`,
                          background: `color-mix(in srgb, ${TYPE_COLORS[entry.type]} 12%, transparent)`,
                        }}
                      >
                        {TYPE_LABELS[entry.type]}
                      </span>
                      {entry.scope && <Badge>{entry.scope}</Badge>}
                      {entry.breaking && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-risk px-2.5 py-0.5 text-[11px] font-semibold text-canvas">
                          <IconAlertTriangle size={11} stroke={2.2} />
                          Breaking
                        </span>
                      )}
                      {isCurrent && <Badge tone="accent">Läuft aktuell</Badge>}
                    </div>

                    <p className={`mt-1.5 text-sm font-medium ${classes.subject}`}>
                      {entry.subject}
                    </p>

                    <div className={`mt-1 flex flex-wrap items-center gap-3 ${classes.meta}`}>
                      <span
                        className="text-xs text-dim"
                        title={dateTimeFormatter.format(new Date(entry.date))}
                      >
                        {entry.date ? dateFormatter.format(new Date(entry.date)) : "—"}
                      </span>
                      {entry.authorName && (
                        <span className="text-xs text-dim">{entry.authorName}</span>
                      )}
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline ${classes.sha}`}
                      >
                        {entry.shortSha}
                        <IconExternalLink size={11} />
                      </a>
                      {entry.prNumber && (
                        <a
                          href={`${GITHUB_PR_BASE}/${entry.prNumber}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
                        >
                          <IconGitPullRequest size={12} />#{entry.prNumber}
                        </a>
                      )}
                      {entry.body && (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          className={`inline-flex items-center gap-1 text-xs text-dim hover:text-ink ${classes.expandButton}`}
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [entry.sha]: !isOpen }))
                          }
                        >
                          {isOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                          Details
                        </button>
                      )}
                    </div>

                    {entry.body && isOpen && (
                      <p className={`mt-2 text-xs text-dim ${classes.body}`}>{entry.body}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
