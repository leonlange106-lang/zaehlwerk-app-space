import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getYearlyReportData } from "../../../lib/report-data";
import { authenticateApiRequest, unauthorizedResponse } from "../../../lib/api-auth";
import { YearlyOverviewReport } from "@/src/components/pdf/YearlyOverviewReport";

// @react-pdf/renderer needs the Node runtime (its own reconciler + fontkit),
// and the report reads live data, so never prerender this.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await authenticateApiRequest(request))) return unauthorizedResponse();

  const params = new URL(request.url).searchParams;
  const yearRaw = params.get("year");
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined;
  const idsParam = params.get("ids") ?? params.get("zaehlerId");
  const ids = idsParam ? idsParam.split(",").map((id) => id.trim()).filter(Boolean) : undefined;

  const data = await getYearlyReportData({ year, ids });

  // renderToBuffer is typed for a <Document> element; YearlyOverviewReport
  // returns exactly that, but its own props type is {data}, so bridge the two.
  const element = React.createElement(YearlyOverviewReport, { data }) as unknown as Parameters<
    typeof renderToBuffer
  >[0];
  const buffer = await renderToBuffer(element);

  const datum = data.generatedAt.slice(0, 10);
  const suffix = year ? `${year}` : datum;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="zaehlwerk_jahresuebersicht_${suffix}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
