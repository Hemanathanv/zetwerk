/**
 * Multi-sheet workbook for Steel Supplier Declaration JSON.
 * Sheets: Run_info, company (key/value), products (table),
 *         certification (key/value), referenceInvoices (table).
 */

import * as XLSX from "xlsx";

type WorkBook = ReturnType<typeof XLSX.utils.book_new>;

function excelSheetName(s: string): string {
  return s.replace(/[:\\/?*[\]]/g, "_").trim().slice(0, 31) || "Sheet";
}

function appendKeyValueSheet(
  wb: WorkBook,
  title: string,
  obj: Record<string, unknown> | null | undefined,
): void {
  const rows: Record<string, unknown>[] = [];
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      rows.push({
        key,
        value:
          value === null || value === undefined
            ? ""
            : typeof value === "object"
              ? JSON.stringify(value)
              : String(value),
      });
    }
  }
  const ws =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.json_to_sheet([{ _note: "no data" }]);
  ws["!cols"] = [{ wch: 28 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws, excelSheetName(title));
}

function appendTableSheet(
  wb: WorkBook,
  title: string,
  rows: unknown[] | null | undefined,
): void {
  const arr = Array.isArray(rows) ? rows : [];
  const normalized = arr.map((r) => {
    if (!r || typeof r !== "object" || Array.isArray(r))
      return { value: JSON.stringify(r) };
    const o = { ...(r as Record<string, unknown>) };
    // Convert array fields to comma-separated strings for readability
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) o[k] = v.join(", ");
    }
    return o;
  });
  const ws =
    normalized.length > 0
      ? XLSX.utils.json_to_sheet(normalized)
      : XLSX.utils.json_to_sheet([{ _note: "no rows" }]);
  XLSX.utils.book_append_sheet(wb, ws, excelSheetName(title));
}

const ENVELOPE_KEYS = new Set(["source", "documentType"]);

export function writeStructuredSsdWorkbook(
  outPath: string,
  data: Record<string, unknown>,
  metaRows: { key: string; value: unknown }[],
): void {
  const wb = XLSX.utils.book_new();

  const runSheet = metaRows.map((r) => ({
    key: r.key,
    value: typeof r.value === "object" ? JSON.stringify(r.value) : String(r.value ?? ""),
  }));
  XLSX.utils.book_append_sheet(
    wb,
    runSheet.length
      ? XLSX.utils.json_to_sheet(runSheet)
      : XLSX.utils.json_to_sheet([{ _note: "no meta" }]),
    "Run_info",
  );

  appendKeyValueSheet(wb, "company", data.company as Record<string, unknown>);
  appendTableSheet(wb, "products", data.products as unknown[]);
  appendKeyValueSheet(wb, "certification", data.certification as Record<string, unknown>);
  appendTableSheet(wb, "referenceInvoices", data.referenceInvoices as unknown[]);

  XLSX.writeFile(wb, outPath);
}
