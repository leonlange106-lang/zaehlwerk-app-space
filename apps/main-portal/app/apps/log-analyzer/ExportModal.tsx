"use client";

import { useCallback, useState } from "react";
import { Button } from "@/app/components/ui/Button";
import { Alert, Divider, SegmentedControl } from "@/app/components/ui/primitives";
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
      <div className="flex flex-col gap-5" data-testid="export-modal">
        {error && (
          <Alert tone="risk" role="alert" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        <div>
          <p className="legend-label mb-2">Format</p>
          <SegmentedControl
            label="Berichtsformat"
            value={format}
            onChange={(v) => setFormat(v as ReportFormat)}
            data-testid="export-format"
            options={[
              {
                value: "pdf" as ReportFormat,
                label: (
                  <span className="flex items-center gap-1.5">
                    <IconFileTypePdf size={15} />
                    PDF-Dokument
                  </span>
                ),
              },
              {
                value: "png" as ReportFormat,
                label: (
                  <span className="flex items-center gap-1.5">
                    <IconPhoto size={15} />
                    PNG-Bild
                  </span>
                ),
              },
            ]}
          />
          <p className="mt-2 text-xs text-dim">
            {format === "pdf"
              ? "Mehrseitiger Bericht im Druck-Layout (A4)."
              : "Hochauflösender Bild-Ausschnitt mit Kennwerten und Diagrammen."}
          </p>
        </div>

        <Divider />

        <div>
          <p className="legend-label mb-3">Inhalte</p>
          <div className="flex flex-col gap-3">
            {SECTION_OPTIONS.map((option) => (
              <label key={option.key} className="flex cursor-pointer gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 flex-none accent-[var(--zw-accent)]"
                  checked={sections[option.key]}
                  onChange={(event) => toggleSection(option.key, event.currentTarget.checked)}
                  data-testid={`export-section-${option.key}`}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{option.label}</span>
                  {option.hint && (
                    <span className="mt-0.5 block text-xs text-dim">{option.hint}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>

        <Divider />

        <div>
          <p className="legend-label mb-2">Darstellung</p>
          <SegmentedControl
            label="Berichts-Darstellung"
            value={theme}
            onChange={(v) => setTheme(v as ReportTheme)}
            data-testid="export-theme"
            options={[
              { value: "light" as ReportTheme, label: "Hell (Druck)" },
              { value: "dark" as ReportTheme, label: "Dunkel" },
            ]}
          />
          <p className="mt-2 text-xs text-dim">
            Hell ist für den Ausdruck optimiert; Dunkel passt zum Dashboard.
          </p>
        </div>

        {/* Both actions span the full width: on a bottom sheet that puts the
            primary one under the thumb instead of in the far corner. */}
        <div className="mt-1 grid grid-cols-2 gap-3">
          <Button type="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !target}
            onClick={() => void run()}
            data-testid="export-submit"
          >
            <IconDownload size={16} />
            {busy ? "Wird erstellt…" : "Exportieren"}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
