"use client";

import { useCallback, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertCircle, IconDownload, IconFileTypePdf, IconPhoto } from "@tabler/icons-react";
import { ResponsiveDialog } from "@/app/components/ui/ResponsiveDialog";
import type { VehicleSpec } from "./lib/vehicle-spec";
import type { DynoProfile } from "./lib/dyno-spec";
import type { CorrectionStandard, DynoOutput } from "./lib/dyno-engine";
import {
  DEFAULT_REPORT_SECTIONS,
  reportFilename,
  type ReportFormat,
  type ReportSections,
  type ReportTheme,
} from "./lib/report-generator";
import { buildReportSvg } from "./lib/report-svg";
import {
  downloadBlob,
  fetchReportPayload,
  fetchReportPdf,
  svgToPngBlob,
  type ReportTarget,
} from "./lib/report-export";

// The "Bericht erstellen" dialog shared by the Analyzer and the Dyno page.
//
// It owns only the user's export CHOICES; the report itself is assembled by the
// server route, so both formats always describe the same run. The PDF arrives
// ready to save, while the PNG comes back as a payload that is drawn through the
// shared SVG builder and rasterized here — a canvas exists only in the browser.

/** Section toggles in the order they appear in the dialog. */
const SECTION_OPTIONS: { key: keyof ReportSections; label: string; hint: string }[] = [
  { key: "wotChart", label: "WOT-Diagramm", hint: "Drehzahl, Ladedruck, Zündung, Gemisch" },
  { key: "violations", label: "Sicherheits-Auffälligkeiten", hint: "Tabelle der Grenzwertverstöße" },
  { key: "dynoCurve", label: "Leistungskurve", hint: "Virtueller Prüfstand: PS & Nm" },
  { key: "fileSummary", label: "Datei-Übersicht", hint: "Zeilen, Kanäle, Pull-Fenster, Gang" },
];

export interface ExportModalProps {
  opened: boolean;
  onClose: () => void;
  /** Which log to report on — a stored id, or a CSV held only in memory. */
  target: ReportTarget | null;
  spec: VehicleSpec;
  /** Vehicle-dynamics inputs for the optional power/torque section. */
  dyno?: {
    profile: DynoProfile;
    output: DynoOutput;
    correction: CorrectionStandard;
  };
  /** Overrides for which sections start ticked (e.g. the dyno page leads with the curve). */
  initialSections?: Partial<ReportSections>;
}

export function ExportModal({
  opened,
  onClose,
  target,
  spec,
  dyno,
  initialSections,
}: ExportModalProps) {
  const [format, setFormat] = useState<ReportFormat>("pdf");
  const [theme, setTheme] = useState<ReportTheme>("light");
  const [sections, setSections] = useState<ReportSections>({
    ...DEFAULT_REPORT_SECTIONS,
    ...initialSections,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSection = useCallback((key: keyof ReportSections, on: boolean) => {
    setSections((prev) => ({ ...prev, [key]: on }));
  }, []);

  const run = useCallback(async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const request = { target, spec, dyno, sections, theme };
      if (format === "pdf") {
        const { blob, filename } = await fetchReportPdf(request);
        downloadBlob(blob, filename);
      } else {
        const payload = await fetchReportPayload(request);
        const blob = await svgToPngBlob(buildReportSvg(payload));
        downloadBlob(blob, reportFilename(payload, "png"));
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Der Bericht konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }, [target, spec, dyno, sections, theme, format, onClose]);

  return (
    <ResponsiveDialog
      opened={opened}
      onClose={onClose}
      // Dismissal is blocked while the report is being generated — closing
      // mid-render would drop a request the server is already working on.
      closeDisabled={busy}
      title="Bericht erstellen"
      size="md"
    >
      <Stack gap="md" data-testid="export-modal">
        {error && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        <div>
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={6}>
            Format
          </Text>
          <SegmentedControl
            fullWidth
            value={format}
            onChange={(v) => setFormat(v as ReportFormat)}
            data-testid="export-format"
            data={[
              {
                value: "pdf",
                label: (
                  <Group gap={6} justify="center" wrap="nowrap">
                    <IconFileTypePdf size={15} />
                    <span>PDF-Dokument</span>
                  </Group>
                ),
              },
              {
                value: "png",
                label: (
                  <Group gap={6} justify="center" wrap="nowrap">
                    <IconPhoto size={15} />
                    <span>PNG-Bild</span>
                  </Group>
                ),
              },
            ]}
          />
          <Text size="xs" c="dimmed" mt={6}>
            {format === "pdf"
              ? "Mehrseitiger Bericht im Druck-Layout (A4)."
              : "Hochauflösender Bild-Ausschnitt mit Kennwerten und Diagrammen."}
          </Text>
        </div>

        <Divider />

        <div>
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={8}>
            Inhalte
          </Text>
          <Stack gap={10}>
            {SECTION_OPTIONS.map((option) => (
              <Checkbox
                key={option.key}
                checked={sections[option.key]}
                onChange={(event) => toggleSection(option.key, event.currentTarget.checked)}
                label={option.label}
                description={option.hint}
                data-testid={`export-section-${option.key}`}
              />
            ))}
          </Stack>
        </div>

        <Divider />

        <div>
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={6}>
            Darstellung
          </Text>
          <SegmentedControl
            fullWidth
            value={theme}
            onChange={(v) => setTheme(v as ReportTheme)}
            data-testid="export-theme"
            data={[
              { value: "light", label: "Hell (Druck)" },
              { value: "dark", label: "Dunkel" },
            ]}
          />
          <Text size="xs" c="dimmed" mt={6}>
            Hell ist für den Ausdruck optimiert; Dunkel passt zum Dashboard.
          </Text>
        </div>

        {/* `grow` rather than right-aligned: on a bottom sheet the two actions
            span the full width, so the primary one is under the thumb instead of
            in the far corner. */}
        <Group grow gap="sm" mt="xs">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            color="orange"
            leftSection={<IconDownload size={16} />}
            loading={busy}
            disabled={!target}
            onClick={() => void run()}
            data-testid="export-submit"
          >
            Exportieren
          </Button>
        </Group>
      </Stack>
    </ResponsiveDialog>
  );
}
