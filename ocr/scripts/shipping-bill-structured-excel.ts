/**
 * Multi-sheet workbook for hierarchical Shipping Bill extraction (one sheet per table / block).
 */

import * as XLSX from "xlsx";
import type { ShippingBillStructuredExtraction } from "../src/types/shipping-bill-structured.js";

function excelSheetName(s: string): string {
  const cleaned = s.replace(/[:\\/?*[\]]/g, "_").trim().slice(0, 31);
  return cleaned || "Sheet";
}

function rowsFromRecord(
  obj: Record<string, unknown> | null | undefined,
): Record<string, unknown>[] {
  if (!obj || typeof obj !== "object") return [{ _note: "no data" }];
  const entries = Object.entries(obj);
  if (entries.length === 0) return [{ _note: "no data" }];
  return entries.map(([key, value]) => ({
    key,
    value:
      value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value),
  }));
}

type WorkBook = ReturnType<typeof XLSX.utils.book_new>;

function appendRowsSheet(wb: WorkBook, title: string, rows: Record<string, unknown>[]): void {
  const name = excelSheetName(title);
  const ws =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.json_to_sheet([{ _note: "no data" }]);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

export function writeStructuredShippingBillWorkbook(
  outPath: string,
  data: ShippingBillStructuredExtraction,
  metaRows: { key: string; value: unknown }[],
): void {
  const wb = XLSX.utils.book_new();

  appendRowsSheet(
    wb,
    "Run_info",
    metaRows.map((r) => ({
      key: r.key,
      value:
        typeof r.value === "object"
          ? JSON.stringify(r.value)
          : String(r.value ?? ""),
    })),
  );

  const p1 = data.part1ShippingBillSummary;
  if (p1) {
    appendRowsSheet(wb, "P1_metadata", rowsFromRecord(p1.metadata as Record<string, unknown>));
    appendRowsSheet(wb, "P1_A_Status", rowsFromRecord(p1.sectionAStatus as Record<string, unknown>));
    appendRowsSheet(
      wb,
      "P1_B_Declarant",
      rowsFromRecord(p1.sectionBDeclarant as Record<string, unknown>),
    );
    appendRowsSheet(
      wb,
      "P1_C_ValSum",
      rowsFromRecord(p1.sectionCValueSummary as Record<string, unknown>),
    );
    appendRowsSheet(
      wb,
      "P1_D_ExPromo",
      rowsFromRecord(p1.sectionDExportPromotion as Record<string, unknown>),
    );
    appendRowsSheet(
      wb,
      "P1_E_Manifest",
      rowsFromRecord(p1.sectionEManifest as Record<string, unknown>),
    );
    appendRowsSheet(
      wb,
      "P1_F_InvSummary",
      (p1.sectionFInvoiceSummary ?? []) as Record<string, unknown>[],
    );
    appendRowsSheet(
      wb,
      "P1_G_Equipment",
      (p1.sectionGEquipmentDetails ?? []) as Record<string, unknown>[],
    );
    appendRowsSheet(
      wb,
      "P1_H_Challan",
      (p1.sectionHChallanDetails ?? []) as Record<string, unknown>[],
    );
    appendRowsSheet(wb, "P1_I_Annex", rowsFromRecord(p1.sectionIAnnex as Record<string, unknown>));
    const j = p1.sectionJProcessDetails;
    if (Array.isArray(j))
      appendRowsSheet(wb, "P1_J_Process", j as Record<string, unknown>[]);
    else appendRowsSheet(wb, "P1_J_Process", rowsFromRecord(j as Record<string, unknown>));
  }

  const p2 = data.part2InvoiceDetails;
  if (p2) {
    appendRowsSheet(wb, "P2_A_REF", (p2.sectionARef ?? []) as Record<string, unknown>[]);
    appendRowsSheet(
      wb,
      "P2_B_Parties",
      rowsFromRecord(p2.sectionBTransactionParties as Record<string, unknown>),
    );
    const c = p2.sectionCValuation;
    if (Array.isArray(c))
      appendRowsSheet(wb, "P2_C_Valuation", c as Record<string, unknown>[]);
    else
      appendRowsSheet(
        wb,
        "P2_C_Valuation",
        rowsFromRecord(c as Record<string, unknown>),
      );
    appendRowsSheet(
      wb,
      "P2_D_Items",
      (p2.sectionDItemDetails ?? []) as Record<string, unknown>[],
    );
  }

  appendRowsSheet(
    wb,
    "P3_Items",
    (data.part3ItemDetails ?? []) as Record<string, unknown>[],
  );

  const p4 = data.part4ExportSchemeDetails;
  if (p4) {
    appendRowsSheet(
      wb,
      "P4_A_DBK_ROSL",
      (p4.sectionADrawbackRosl ?? []) as Record<string, unknown>[],
    );
    appendRowsSheet(
      wb,
      "P4_B_AADFIA",
      (p4.sectionBAaDfiaLicence ?? []) as Record<string, unknown>[],
    );
    appendRowsSheet(wb, "P4_C_Jobbing", (p4.sectionCJobbing ?? []) as Record<string, unknown>[]);
    appendRowsSheet(
      wb,
      "P4_D_SingleWin",
      (p4.sectionDSingleWindowDeclaration ?? []) as Record<string, unknown>[],
    );
    appendRowsSheet(
      wb,
      "P4_E_Constituent",
      (p4.sectionEConstituents ?? []) as Record<string, unknown>[],
    );
    appendRowsSheet(wb, "P4_F_Control", (p4.sectionFControl ?? []) as Record<string, unknown>[]);
    appendRowsSheet(
      wb,
      "P4_G_SupportDoc",
      (p4.sectionGSupportingDocuments ?? []) as Record<string, unknown>[],
    );
    appendRowsSheet(
      wb,
      "P4_H_Invoices",
      (p4.sectionHInvoiceDetails ?? []) as Record<string, unknown>[],
    );
    appendRowsSheet(
      wb,
      "P4_I_Container",
      (p4.sectionIContainer ?? []) as Record<string, unknown>[],
    );
    appendRowsSheet(wb, "P4_J_AR4", (p4.sectionJAr4 ?? []) as Record<string, unknown>[]);
    appendRowsSheet(
      wb,
      "P4_K_ThirdParty",
      (p4.sectionKThirdParty ?? []) as Record<string, unknown>[],
    );
    appendRowsSheet(wb, "P4_L_Mfg", (p4.sectionLManufacturer ?? []) as Record<string, unknown>[]);
    appendRowsSheet(wb, "P4_M_RoDTEP", (p4.sectionMRodtep ?? []) as Record<string, unknown>[]);
    appendRowsSheet(
      wb,
      "P4_N_Reexport",
      (p4.sectionNReexport ?? []) as Record<string, unknown>[],
    );
  }

  const p5 = data.part5Declarations;
  if (p5) {
    const stmt = p5.declarationStatement;
    const stmtRows: Record<string, unknown>[] = Array.isArray(stmt)
      ? stmt.map((t, i) => ({ idx: i, text: t }))
      : [{ text: stmt ?? "" }];
    appendRowsSheet(wb, "P5_Declaration", stmtRows);
    appendRowsSheet(
      wb,
      "P5_Signatory",
      rowsFromRecord(p5.authorizedSignatory as Record<string, unknown>),
    );
  }

  XLSX.writeFile(wb, outPath);
}
