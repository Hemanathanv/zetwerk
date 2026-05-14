/**
 * Multi-sheet workbook for Delivery Deduction Sheet JSON.
 * Sheets: Run_info, company (kv), shipmentReference (kv), parties (kv),
 *         referenceInvoices (table), originCharges (kv).
 */

import * as XLSX from "xlsx";

type WorkBook = ReturnType<typeof XLSX.utils.book_new>;

function appendKvSheet(wb: WorkBook, title: string, obj: Record<string, unknown> | null | undefined): void {
  const rows = obj
    ? Object.entries(obj).map(([key, value]) => ({
        key,
        value: value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value),
      }))
    : [{ key: "_note", value: "no data" }];
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 28 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
}

function appendTableSheet(wb: WorkBook, title: string, rows: unknown[] | null | undefined): void {
  const arr = Array.isArray(rows) ? rows : [];
  const norm = arr.map((r) =>
    r && typeof r === "object" && !Array.isArray(r) ? { ...(r as Record<string, unknown>) } : { value: JSON.stringify(r) },
  );
  const ws = norm.length > 0 ? XLSX.utils.json_to_sheet(norm) : XLSX.utils.json_to_sheet([{ _note: "no rows" }]);
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
}

export function writeStructuredDdsWorkbook(
  outPath: string,
  data: Record<string, unknown>,
  metaRows: { key: string; value: unknown }[],
): void {
  const wb = XLSX.utils.book_new();

  const runRows = metaRows.map((r) => ({
    key: r.key,
    value: typeof r.value === "object" ? JSON.stringify(r.value) : String(r.value ?? ""),
  }));
  const wsMeta = runRows.length ? XLSX.utils.json_to_sheet(runRows) : XLSX.utils.json_to_sheet([{ _note: "no meta" }]);
  XLSX.utils.book_append_sheet(wb, wsMeta, "Run_info");

  appendKvSheet(wb, "company", data.company as Record<string, unknown>);
  appendKvSheet(wb, "shipmentReference", data.shipmentReference as Record<string, unknown>);
  appendKvSheet(wb, "parties", data.parties as Record<string, unknown>);
  appendTableSheet(wb, "referenceInvoices", data.referenceInvoices as unknown[]);
  appendKvSheet(wb, "originCharges", data.originCharges as Record<string, unknown>);

  XLSX.writeFile(wb, outPath);
}
