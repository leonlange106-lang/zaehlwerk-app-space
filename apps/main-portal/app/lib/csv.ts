export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Minimaler CSV-Parser: erkennt Trennzeichen (; oder ,) automatisch aus der
 * ersten Zeile, versteht in Anführungszeichen eingeschlossene Felder mit ""-
 * Escaping, und entfernt ein BOM. Ausreichend für unsere eigenen Exporte und
 * gängige Tabellenkalkulations-CSVs.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const newlineIndex = text.indexOf("\n");
  const firstLine = newlineIndex >= 0 ? text.slice(0, newlineIndex) : text;
  const semis = firstLine.split(";").length - 1;
  const commas = firstLine.split(",").length - 1;
  const delimiter = semis >= commas ? ";" : ",";

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const cleaned = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (cleaned.length === 0) return { headers: [], rows: [] };
  const [headers, ...dataRows] = cleaned;
  return { headers: headers.map((h) => h.trim()), rows: dataRows };
}
