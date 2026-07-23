"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Group,
  MultiSelect,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconDownload, IconFileTypeCsv, IconFileTypePdf } from "@tabler/icons-react";

type Period = "all" | "current" | "last" | "custom";
type Delimiter = "semicolon" | "comma";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function ExportPanel({ meters }: { meters: { id: string; name: string }[] }) {
  // "now" einmalig einfrieren — Date im Render wäre unrein (react-hooks/purity).
  const [now] = useState(() => new Date());
  const currentYear = now.getFullYear();

  // "Alles" ist der Default: die häufigste Absicht ist ein Gesamtüberblick über
  // die komplette Historie, nicht ein einzelnes Jahr.
  const [period, setPeriod] = useState<Period>("all");
  const [customFrom, setCustomFrom] = useState<string>(`${currentYear}-01-01`);
  const [customTo, setCustomTo] = useState<string>(isoDate(now));
  const [selected, setSelected] = useState<string[]>([]);
  const [delimiter, setDelimiter] = useState<Delimiter>("semicolon");

  // Zeitraum → konkrete from/to-Grenzen + (falls eindeutig) Berichtsjahr.
  // "Alles" lässt from/to/year offen: ohne diese Filter berücksichtigen CSV wie
  // PDF die gesamte vorhandene Historie.
  const range = useMemo((): { from?: string; to?: string; year?: number } => {
    if (period === "all") {
      return { from: undefined, to: undefined, year: undefined };
    }
    if (period === "current") {
      return { from: `${currentYear}-01-01`, to: isoDate(now), year: currentYear };
    }
    if (period === "last") {
      return { from: `${currentYear - 1}-01-01`, to: `${currentYear - 1}-12-31`, year: currentYear - 1 };
    }
    const fromYear = customFrom.slice(0, 4);
    const toYear = customTo.slice(0, 4);
    return {
      from: customFrom,
      to: customTo,
      year: fromYear && fromYear === toYear ? Number(fromYear) : undefined,
    };
  }, [period, customFrom, customTo, currentYear, now]);

  function buildCsvHref(): string {
    const params = new URLSearchParams();
    if (selected.length > 0) params.set("ids", selected.join(","));
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    params.set("sep", delimiter);
    return `/api/export?${params.toString()}`;
  }

  function buildPdfHref(): string {
    const params = new URLSearchParams();
    if (selected.length > 0) params.set("ids", selected.join(","));
    if (range.year) params.set("year", String(range.year));
    const query = params.toString();
    return query ? `/api/export/pdf?${query}` : "/api/export/pdf";
  }

  return (
    <Card withBorder radius="md" p="lg">
      <Group gap="xs" mb="xs">
        <IconDownload size={18} stroke={1.6} />
        <Title order={4}>Export</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Zählerstände, Verbräuche und Kosten nach Zeitraum und Zähler gefiltert als CSV oder PDF
        exportieren.
      </Text>

      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
          <Select
            label="Zeitraum"
            data={[
              { value: "all", label: "Alles" },
              { value: "current", label: "Dieses Jahr" },
              { value: "last", label: "Letztes Jahr" },
              { value: "custom", label: "Benutzerdefiniert" },
            ]}
            value={period}
            onChange={(value) => setPeriod((value as Period) ?? "all")}
            allowDeselect={false}
          />
          <TextInput
            label="Von"
            type="date"
            value={customFrom}
            onChange={(event) => setCustomFrom(event.currentTarget.value)}
            disabled={period !== "custom"}
          />
          <TextInput
            label="Bis"
            type="date"
            value={customTo}
            onChange={(event) => setCustomTo(event.currentTarget.value)}
            disabled={period !== "custom"}
          />
          <Select
            label="CSV-Trennzeichen"
            data={[
              { value: "semicolon", label: "Semikolon (;) – Excel DE" },
              { value: "comma", label: "Komma (,) – international" },
            ]}
            value={delimiter}
            onChange={(value) => setDelimiter((value as Delimiter) ?? "semicolon")}
            allowDeselect={false}
          />
        </SimpleGrid>

        <MultiSelect
          label="Zähler"
          placeholder={selected.length === 0 ? "Alle Zähler" : undefined}
          data={meters.map((meter) => ({ value: meter.id, label: meter.name }))}
          value={selected}
          onChange={setSelected}
          clearable
          searchable
        />

        <Group gap="sm">
          <Button
            component="a"
            href={buildCsvHref()}
            download
            color="slate"
            leftSection={<IconFileTypeCsv size={16} />}
          >
            CSV exportieren
          </Button>
          <Button
            component="a"
            href={buildPdfHref()}
            download
            variant="light"
            color="slate"
            leftSection={<IconFileTypePdf size={16} />}
          >
            PDF-Bericht{range.year ? ` ${range.year}` : period === "all" ? " (Alles)" : ""}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
