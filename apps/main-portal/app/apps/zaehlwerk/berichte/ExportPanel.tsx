"use client";

import { useMemo, useState } from "react";
import { IconDownload, IconFileTypeCsv, IconFileTypePdf } from "@tabler/icons-react";
import { ButtonLink } from "@/app/components/ui/Button";
import { Field, Select, SelectShell, TextInput } from "@/app/components/ui/Field";
import { Panel } from "@/app/components/ui/Panel";
import { cn } from "@/app/lib/cn";

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

  const toggleMeter = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id],
    );
  };

  return (
    <Panel
      title="Export"
      description="Zählerstände, Verbräuche und Kosten nach Zeitraum und Zähler gefiltert als CSV oder PDF exportieren."
      icon={<IconDownload size={17} stroke={1.7} />}
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Zeitraum">
            {({ id }) => (
              <SelectShell>
                <Select
                  id={id}
                  value={period}
                  onChange={(event) => setPeriod(event.currentTarget.value as Period)}
                >
                  <option value="all">Alles</option>
                  <option value="current">Dieses Jahr</option>
                  <option value="last">Letztes Jahr</option>
                  <option value="custom">Benutzerdefiniert</option>
                </Select>
              </SelectShell>
            )}
          </Field>
          <Field label="Von">
            {({ id }) => (
              <TextInput
                id={id}
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.currentTarget.value)}
                disabled={period !== "custom"}
              />
            )}
          </Field>
          <Field label="Bis">
            {({ id }) => (
              <TextInput
                id={id}
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.currentTarget.value)}
                disabled={period !== "custom"}
              />
            )}
          </Field>
          <Field label="CSV-Trennzeichen">
            {({ id }) => (
              <SelectShell>
                <Select
                  id={id}
                  value={delimiter}
                  onChange={(event) => setDelimiter(event.currentTarget.value as Delimiter)}
                >
                  <option value="semicolon">Semikolon (;) – Excel DE</option>
                  <option value="comma">Komma (,) – international</option>
                </Select>
              </SelectShell>
            )}
          </Field>
        </div>

        {/* Toggle chips rather than a combobox: the list is short, every option
            fits on screen, and "none selected = all" is far easier to see when
            the alternative is an empty field claiming "Alle Zähler". */}
        <fieldset className="min-w-0">
          <legend className="mb-2 text-[13px] font-medium">
            Zähler{" "}
            <span className="font-normal text-dim">
              {selected.length === 0 ? "— alle" : `— ${selected.length} ausgewählt`}
            </span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {meters.map((meter) => {
              const active = selected.includes(meter.id);
              return (
                <label
                  key={meter.id}
                  className={cn(
                    "inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3.5 text-[13px] transition-colors",
                    active
                      ? "border-transparent bg-[color-mix(in_srgb,var(--zw-accent)_18%,transparent)] font-semibold text-accent"
                      : "border-line text-dim hover:border-line-strong hover:text-ink",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={active}
                    onChange={() => toggleMeter(meter.id)}
                  />
                  {meter.name}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <ButtonLink href={buildCsvHref()} download variant="primary">
            <IconFileTypeCsv size={16} />
            CSV exportieren
          </ButtonLink>
          <ButtonLink href={buildPdfHref()} download>
            <IconFileTypePdf size={16} />
            PDF-Bericht{range.year ? ` ${range.year}` : period === "all" ? " (Alles)" : ""}
          </ButtonLink>
        </div>
      </div>
    </Panel>
  );
}
