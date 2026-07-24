import type { DynoProfile } from "./dyno-spec";
import type { CorrectionStandard, DynoOutput } from "./dyno-engine";
import type { VehicleSpec } from "./vehicle-spec";
import type { ReportFormat, ReportPayload, ReportSections, ReportTheme } from "./report-generator";

// Browser-side half of the report exporter: talk to the report route, rasterize
// the SVG snippet to PNG, and hand the result to the user as a download.
//
// The report payload is always built on the server (see the route), so this
// module never touches the analysis engines — it only transports and rasterizes.
//
// Object URLs are created in exactly two places here and both revoke in a
// `finally`; an export that fails midway must not leak the blob it allocated.

const ENDPOINT = "/api/apps/log-analyzer/report";

/** Which log to report on: a stored one by id, or a CSV held only in memory. */
export type ReportTarget = { logId: string } | { name: string; csv: string };

export interface ReportRequest {
  target: ReportTarget;
  spec: VehicleSpec;
  /** Vehicle-dynamics inputs; the server only uses them for the dyno section. */
  dyno?: {
    profile: DynoProfile;
    output: DynoOutput;
    correction: CorrectionStandard;
  };
  sections: ReportSections;
  theme: ReportTheme;
}

function requestBody(request: ReportRequest, format: ReportFormat): string {
  return JSON.stringify({
    format,
    theme: request.theme,
    sections: request.sections,
    spec: request.spec,
    dyno: request.dyno ?? null,
    ...request.target,
  });
}

async function errorFrom(response: Response): Promise<Error> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return new Error(data.error ?? "Der Bericht konnte nicht erstellt werden.");
}

/** Pull the download filename out of a Content-Disposition header. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match ? match[1] : fallback;
}

/**
 * Render the report server-side and return the PDF plus the filename the route
 * derived from the payload — the client has no need to rebuild that name.
 */
export async function fetchReportPdf(
  request: ReportRequest,
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody(request, "pdf"),
  });
  if (!response.ok) throw await errorFrom(response);
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(
      response.headers.get("Content-Disposition"),
      "zaehlwerk-logbericht.pdf",
    ),
  };
}

/** Fetch the assembled payload so the browser can draw the PNG snippet. */
export async function fetchReportPayload(request: ReportRequest): Promise<ReportPayload> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody(request, "png"),
  });
  if (!response.ok) throw await errorFrom(response);
  const data = (await response.json()) as { payload: ReportPayload };
  return data.payload;
}

/**
 * Encode an SVG string as a base64 data URL.
 *
 * `btoa` only accepts Latin-1, and the report is full of characters that are
 * not (°, λ, ä, ·), so the string is UTF-8 encoded first. A data URL is used in
 * preference to an object URL because WebKit refuses to load blob:-backed SVG
 * into an <img>, which is exactly what the rasterizer needs.
 */
export function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  // Chunked so a large report cannot blow the argument limit of String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/**
 * Rasterize an SVG document string to a PNG blob at its intrinsic size (the SVG
 * is authored with the high-DPI scale already baked into width/height, so the
 * text is drawn crisp rather than upscaled).
 */
export async function svgToPngBlob(svg: string): Promise<Blob> {
  const image = new Image();
  image.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Das Bericht-Bild konnte nicht gerendert werden."));
    image.src = svgToDataUrl(svg);
  });

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas wird von diesem Browser nicht unterstützt.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG-Export fehlgeschlagen."))),
      "image/png",
    );
  });
}

/** Trigger a browser download for a generated blob, then release its URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Safari needs the URL to outlive the click by a tick before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
