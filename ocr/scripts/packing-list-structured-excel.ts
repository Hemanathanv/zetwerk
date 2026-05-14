/**
 * Multi-sheet workbook for structured Packing Lists JSON (object sections + lineItems table).
 */

import * as XLSX from "xlsx";

function excelSheetName(s: string): string {
  const cleaned = s.replace(/[:\\/?*[\]]/g, "_").trim().slice(0, 31);
  return cleaned || "Sheet";
}

type WorkBook = ReturnType<typeof XLSX.utils.book_new>;

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
  const name = excelSheetName(title);
  const ws =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.json_to_sheet([{ _note: "no data" }]);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

function appendTableSheet(
  wb: WorkBook,
  title: string,
  rows: unknown[] | null | undefined,
): void {
  const name = excelSheetName(title);
  const arr = Array.isArray(rows) ? rows : [];
  const normalized = arr.map((r) =>
    r && typeof r === "object" && !Array.isArray(r)
      ? (r as Record<string, unknown>)
      : { value: JSON.stringify(r) },
  );
  const ws =
    normalized.length > 0
      ? XLSX.utils.json_to_sheet(normalized)
      : XLSX.utils.json_to_sheet([{ _note: "no rows" }]);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

const ENVELOPE_KEYS = new Set(["source", "documentType"]);

export function writeStructuredPackingListWorkbook(
  outPath: string,
  data: Record<string, unknown>,
  metaRows: { key: string; value: unknown }[],
  sectionOrder: string[],
): void {
  const wb = XLSX.utils.book_new();

  const runSheet = metaRows.map((r) => ({
    key: r.key,
    value:
      typeof r.value === "object"
        ? JSON.stringify(r.value)
        : String(r.value ?? ""),
  }));
  XLSX.utils.book_append_sheet(
    wb,
    runSheet.length
      ? XLSX.utils.json_to_sheet(runSheet)
      : XLSX.utils.json_to_sheet([{ _note: "no meta" }]),
    excelSheetName("Run_info"),
  );

  const keys = Object.keys(data).filter(
    (k) => !ENVELOPE_KEYS.has(k) && !k.startsWith("_"),
  );
  const ordered: string[] = [];
  for (const k of sectionOrder) if (keys.includes(k)) ordered.push(k);
  for (const k of keys.sort()) if (!ordered.includes(k)) ordered.push(k);

  for (const key of ordered) {
    const v = data[key];
    if (Array.isArray(v)) {
      appendTableSheet(wb, key, v);
    } else if (v && typeof v === "object") {
      appendKeyValueSheet(wb, key, v as Record<string, unknown>);
    } else {
      appendKeyValueSheet(wb, key, { value: v });
    }
  }

  XLSX.writeFile(wb, outPath);
}
