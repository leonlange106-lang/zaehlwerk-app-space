import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getYearlyReportData } from "../../../lib/report-data";
import { YearlyOverviewReport } from "@/src/components/pdf/YearlyOverviewReport";

// @react-pdf/renderer needs the Node runtime (its own reconciler + fontkit),
// and the report reads live data, so never prerender this.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getYearlyReportData();

  // renderToBuffer is typed for a <Document> element; YearlyOverviewReport
  // returns exactly that, but its own props type is {data}, so bridge the two.
  const element = React.createElement(YearlyOverviewReport, { data }) as unknown as Parameters<
    typeof renderToBuffer
  >[0];
  const buffer = await renderToBuffer(element);

  const datum = data.generatedAt.slice(0, 10);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="zaehlwerk_jahresuebersicht_${datum}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
