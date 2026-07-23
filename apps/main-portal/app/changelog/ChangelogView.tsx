"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Card,
  Chip,
  Collapse,
  Group,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Timeline,
  Title,
  UnstyledButton,
} from "@mantine/core";
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

const TYPE_COLORS: Record<ChangelogType, string> = {
  feat: "teal",
  fix: "red",
  perf: "grape",
  refactor: "blue",
  docs: "gray",
  chore: "gray",
  test: "cyan",
  build: "indigo",
  ci: "indigo",
  style: "pink",
  revert: "orange",
  other: "gray",
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

  const activeIndex = currentSha
    ? filtered.findIndex((entry) => entry.sha === currentSha)
    : -1;

  return (
    <Stack gap="lg">
      <div>
        <Group gap="sm" mb={4}>
          <ThemeIcon size={32} radius="md" variant="light" color="slate">
            <IconHistory size={19} stroke={1.6} />
          </ThemeIcon>
          <div>
            <Title order={2}>Changelog</Title>
            <Text c="dimmed" size="sm">
              Alle Änderungen dieser Instanz – filterbar nach Art, Text und mehr.
            </Text>
          </div>
        </Group>
      </div>

      {error ? (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="Changelog nicht verfügbar">
          {error}
          <Text size="xs" c="dimmed" mt={4}>
            Meist fehlt oder ist der <code>GITHUB_TOKEN</code> abgelaufen (privates Repo). Details in DEPLOYMENT.md.
          </Text>
        </Alert>
      ) : (
        <>
          <Card withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" wrap="wrap" gap="sm">
                <TextInput
                  className={classes.search}
                  placeholder="Suchen (Text, Scope, PR #, SHA, Autor)…"
                  leftSection={<IconSearch size={15} />}
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  size="sm"
                  radius="sm"
                />
                <SegmentedControl
                  size="xs"
                  value={sort}
                  onChange={(value) => setSort(value as SortOrder)}
                  data={[
                    { label: "Neueste zuerst", value: "newest" },
                    { label: "Älteste zuerst", value: "oldest" },
                  ]}
                />
              </Group>

              <Chip.Group multiple value={selectedTypes} onChange={setSelectedTypes}>
                <Group gap={6}>
                  {availableTypes.map((type) => (
                    <Chip key={type} value={type} size="xs" variant="outline" color={TYPE_COLORS[type]}>
                      {TYPE_LABELS[type]} ({typeCounts.get(type)})
                    </Chip>
                  ))}
                  {breakingCount > 0 && (
                    <Chip
                      checked={breakingOnly}
                      onChange={setBreakingOnly}
                      size="xs"
                      variant="outline"
                      color="red"
                    >
                      ⚠ Breaking ({breakingCount})
                    </Chip>
                  )}
                </Group>
              </Chip.Group>

              <Text size="xs" c="dimmed">
                {filtered.length} von {entries.length} Einträgen
                {(selectedTypes.length > 0 || breakingOnly || search.trim()) && (
                  <>
                    {" · "}
                    <Anchor
                      component="button"
                      type="button"
                      size="xs"
                      onClick={() => {
                        setSearch("");
                        setSelectedTypes([]);
                        setBreakingOnly(false);
                      }}
                    >
                      Filter zurücksetzen
                    </Anchor>
                  </>
                )}
              </Text>
            </Stack>
          </Card>

          {filtered.length === 0 ? (
            <Card withBorder radius="md" p="xl">
              <Text c="dimmed" size="sm" ta="center">
                Keine Einträge für diese Filter.
              </Text>
            </Card>
          ) : (
            <Timeline active={activeIndex >= 0 ? activeIndex : undefined} bulletSize={18} lineWidth={2}>
              {filtered.map((entry) => {
                const isCurrent = currentSha != null && entry.sha === currentSha;
                const isOpen = expanded[entry.sha] ?? false;
                return (
                  <Timeline.Item
                    key={entry.sha}
                    color={TYPE_COLORS[entry.type]}
                    bullet={<span className={classes.bullet} data-current={isCurrent || undefined} />}
                    title={
                      <Group gap="xs" wrap="wrap">
                        <Badge size="sm" variant="light" color={TYPE_COLORS[entry.type]}>
                          {TYPE_LABELS[entry.type]}
                        </Badge>
                        {entry.scope && (
                          <Badge size="sm" variant="outline" color="slate">
                            {entry.scope}
                          </Badge>
                        )}
                        {entry.breaking && (
                          <Badge size="sm" variant="filled" color="red" leftSection={<IconAlertTriangle size={11} />}>
                            Breaking
                          </Badge>
                        )}
                        {isCurrent && (
                          <Badge size="sm" variant="dot" color="green">
                            Läuft aktuell
                          </Badge>
                        )}
                      </Group>
                    }
                  >
                    <Text size="sm" fw={500} className={classes.subject}>
                      {entry.subject}
                    </Text>

                    <Group gap="sm" mt={4} className={classes.meta}>
                      <Text span size="xs" c="dimmed" title={dateTimeFormatter.format(new Date(entry.date))}>
                        {entry.date ? dateFormatter.format(new Date(entry.date)) : "—"}
                      </Text>
                      {entry.authorName && (
                        <Text span size="xs" c="dimmed">
                          {entry.authorName}
                        </Text>
                      )}
                      <Anchor href={entry.url} target="_blank" rel="noreferrer" size="xs" className={classes.sha}>
                        {entry.shortSha}
                        <IconExternalLink size={11} />
                      </Anchor>
                      {entry.prNumber && (
                        <Anchor
                          href={`${GITHUB_PR_BASE}/${entry.prNumber}`}
                          target="_blank"
                          rel="noreferrer"
                          size="xs"
                        >
                          <Group gap={2} wrap="nowrap">
                            <IconGitPullRequest size={12} />#{entry.prNumber}
                          </Group>
                        </Anchor>
                      )}
                      {entry.body && (
                        <UnstyledButton
                          className={classes.expandButton}
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [entry.sha]: !isOpen }))
                          }
                        >
                          <Group gap={2} wrap="nowrap">
                            {isOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                            Details
                          </Group>
                        </UnstyledButton>
                      )}
                    </Group>

                    {entry.body && (
                      <Collapse in={isOpen}>
                        <Text size="xs" c="dimmed" className={classes.body}>
                          {entry.body}
                        </Text>
                      </Collapse>
                    )}
                  </Timeline.Item>
                );
              })}
            </Timeline>
          )}
        </>
      )}
    </Stack>
  );
}
