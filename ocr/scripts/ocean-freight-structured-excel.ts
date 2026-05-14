/**
 * Multi-sheet workbook for Ocean Freight Invoice JSON.
 */

import * as XLSX from "xlsx";

type WorkBook = ReturnType<typeof XLSX.utils.book_new>;

function kvSheet(wb: WorkBook, title: string, obj: Record<string, unknown> | null | undefined): void {
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

function tableSheet(wb: WorkBook, title: string, rows: unknown[] | null | undefined): void {
  const arr = Array.isArray(rows) ? rows : [];
  const norm = arr.map((r) =>
    r && typeof r === "object" && !Array.isArray(r) ? { ...(r as Record<string, unknown>) } : { value: JSON.stringify(r) },
  );
  const ws = norm.length ? XLSX.utils.json_to_sheet(norm) : XLSX.utils.json_to_sheet([{ _note: "no rows" }]);
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
}

function taxSummarySheet(wb: WorkBook, title: string, raw: unknown): void {
  kvSheet(wb, title, { taxSummary: raw === null || raw === undefined ? null : (typeof raw === "object" ? JSON.stringify(raw) : String(raw)) } as Record<string, unknown>);
}

export function writeStructuredOceanFreightWorkbook(
  outPath: string,
  invoiceBody: Record<string, unknown>,
  metaRows: { key: string; value: unknown }[],
): void {
  const wb = XLSX.utils.book_new();
  const run = metaRows.map((r) => ({
    key: r.key,
    value: typeof r.value === "object" ? JSON.stringify(r.value) : String(r.value ?? ""),
  }));
  XLSX.utils.book_append_sheet(wb, run.length ? XLSX.utils.json_to_sheet(run) : XLSX.utils.json_to_sheet([{}]), "Run_info");

  kvSheet(wb, "issuer", invoiceBody.issuer as Record<string, unknown>);
  kvSheet(wb, "invoiceId", invoiceBody.invoiceIdentification as Record<string, unknown>);
  kvSheet(wb, "customer", invoiceBody.customer as Record<string, unknown>);
  kvSheet(wb, "shipment", invoiceBody.shipment as Record<string, unknown>);
  kvSheet(wb, "cargo", invoiceBody.cargo as Record<string, unknown>);
  kvSheet(wb, "containers", {
    containers: invoiceBody.containers ?? null,
    totalContainers: invoiceBody.totalContainers ?? null,
  } as Record<string, unknown>);
  tableSheet(wb, "charges", invoiceBody.charges as unknown[]);
  taxSummarySheet(wb, "taxSummary", invoiceBody.taxSummary);
  kvSheet(wb, "totals", invoiceBody.totals as Record<string, unknown>);
  kvSheet(wb, "bankDetails", invoiceBody.bankDetails as Record<string, unknown>);
  kvSheet(wb, "additionalBank", invoiceBody.additionalBankDetails as Record<string, unknown>);
  kvSheet(wb, "footer", invoiceBody.footer as Record<string, unknown>);

  XLSX.writeFile(wb, outPath);
}

function safeSheetName(base: string, i: number): string {
  return `${base}_${i + 1}`.replace(/[:\\/?*[\]]/g, "_").slice(0, 31);
}

export function writeOceanFreightWorkbookFromPayload(
  outPath: string,
  payload: Record<string, unknown>,
  metaRows: { key: string; value: unknown }[],
): void {
  const multi = payload.multiInvoice === true;
  const invoices = multi && Array.isArray(payload.invoices) ? (payload.invoices as Record<string, unknown>[]) : null;

  if (!multi || !invoices?.length) {
    writeStructuredOceanFreightWorkbook(outPath, payload, metaRows);
    return;
  }

  const wb = XLSX.utils.book_new();
  const run = metaRows.map((r) => ({
    key: r.key,
    value: typeof r.value === "object" ? JSON.stringify(r.value) : String(r.value ?? ""),
  }));
  run.push({ key: "multiInvoice", value: "true" });
  run.push({ key: "invoiceCount", value: String(invoices.length) });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(run), "Run_info");

  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i]!;
    const p = safeSheetName("Inv", i);
    kvSheet(wb, `${p}_issuer`, inv.issuer as Record<string, unknown>);
    kvSheet(wb, `${p}_invId`, inv.invoiceIdentification as Record<string, unknown>);
    kvSheet(wb, `${p}_cust`, inv.customer as Record<string, unknown>);
    kvSheet(wb, `${p}_ship`, inv.shipment as Record<string, unknown>);
    kvSheet(wb, `${p}_cargo`, inv.cargo as Record<string, unknown>);
    kvSheet(wb, `${p}_cont`, {
      containers: inv.containers ?? null,
      totalContainers: inv.totalContainers ?? null,
    } as Record<string, unknown>);
    tableSheet(wb, `${p}_chrg`, inv.charges as unknown[]);
    taxSummarySheet(wb, `${p}_tax`, inv.taxSummary);
    kvSheet(wb, `${p}_tot`, inv.totals as Record<string, unknown>);
    kvSheet(wb, `${p}_bank`, inv.bankDetails as Record<string, unknown>);
    kvSheet(wb, `${p}_bank2`, inv.additionalBankDetails as Record<string, unknown>);
    kvSheet(wb, `${p}_foot`, inv.footer as Record<string, unknown>);
  }

  XLSX.writeFile(wb, outPath);
}
