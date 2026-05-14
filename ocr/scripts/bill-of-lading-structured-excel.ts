/**
 * Multi-sheet workbook for Bill of Lading structured JSON (snake_case).
 */

import * as XLSX from "xlsx";

type WorkBook = ReturnType<typeof XLSX.utils.book_new>;

function kv(wb: WorkBook, title: string, obj: Record<string, unknown> | null | undefined): void {
  const rows = obj
    ? Object.entries(obj).map(([key, value]) => ({
        key,
        value: value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value),
      }))
    : [{ key: "_note", value: "no data" }];
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 32 }, { wch: 72 }];
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
}

function table(wb: WorkBook, title: string, rows: unknown[] | null | undefined): void {
  const arr = Array.isArray(rows) ? rows : [];
  const norm = arr.map((r) =>
    r && typeof r === "object" && !Array.isArray(r) ? { ...(r as Record<string, unknown>) } : { value: JSON.stringify(r) },
  );
  const ws = norm.length ? XLSX.utils.json_to_sheet(norm) : XLSX.utils.json_to_sheet([{ _note: "no rows" }]);
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
}

export function writeBillOfLadingWorkbookFromPayload(
  outPath: string,
  body: Record<string, unknown>,
  metaRows: { key: string; value: unknown }[],
): void {
  const wb = XLSX.utils.book_new();
  const run = metaRows.map((r) => ({
    key: r.key,
    value: typeof r.value === "object" ? JSON.stringify(r.value) : String(r.value ?? ""),
  }));
  XLSX.utils.book_append_sheet(wb, run.length ? XLSX.utils.json_to_sheet(run) : XLSX.utils.json_to_sheet([{}]), "Run_info");

  kv(wb, "document", {
    document_title: body.document_title ?? null,
    bol_number: body.bol_number ?? null,
    shipment_reference_number: body.shipment_reference_number ?? null,
    negotiability: body.negotiability ?? null,
    project_name: body.project_name ?? null,
    ships_remarks: body.ships_remarks ?? null,
  } as Record<string, unknown>);

  kv(wb, "carrier", body.carrier as Record<string, unknown>);
  kv(wb, "shipper", body.shipper as Record<string, unknown>);
  kv(wb, "consignee", body.consignee as Record<string, unknown>);
  kv(wb, "notify_party", body.notify_party as Record<string, unknown>);
  kv(wb, "second_notify", body.second_notify_party as Record<string, unknown>);
  kv(wb, "delivery_agent", body.delivery_agent as Record<string, unknown>);
  kv(wb, "routing", body.routing as Record<string, unknown>);
  kv(wb, "vessel", body.vessel as Record<string, unknown>);
  kv(wb, "cargo", body.cargo as Record<string, unknown>);
  kv(wb, "freight", body.freight as Record<string, unknown>);
  kv(wb, "issuance", body.issuance as Record<string, unknown>);
  table(wb, "invoices", body.invoices as unknown[]);
  table(wb, "shipping_bills", body.shipping_bills as unknown[]);
  table(wb, "containers", Array.isArray(body.containers) ? body.containers : []);
  kv(wb, "extraction_metadata", body._extraction_metadata as Record<string, unknown>);

  XLSX.writeFile(wb, outPath);
}
