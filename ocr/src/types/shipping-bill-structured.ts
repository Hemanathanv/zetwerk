/**
 * Canonical hierarchical shape for Indian ICEGATE Shipping Bill (LEO) extraction.
 * Tabular sections are always arrays (0..n rows). Single-value blocks are objects.
 * Downstream code should treat every table as list-capable even when the PDF shows one row.
 */

/** Part I — F, G, H and similar blocks are multi-row tables on the form. */
export interface Part1InvoiceSummaryRow {
  sno?: string | null;
  invNo?: string | null;
  invAmt?: string | null;
  currency?: string | null;
}

export interface Part1EquipmentRow {
  container?: string | null;
  seal?: string | null;
  date?: string | null;
  sNo?: string | null;
}

export interface Part1ChallanRow {
  srNo?: string | null;
  challanNo?: string | null;
  paymentDate?: string | null;
  amount?: string | null;
}

export interface Part1ShippingBillSummary {
  metadata?: Record<string, string | null>;
  /**
   * Part I §A STATUS: Y/N flags (MODE, ASSESS, …) and logistics printed in the same block
   * (port of loading, state of origin, port/country of discharge and final destination).
   */
  sectionAStatus?: Record<string, string | null>;
  /** Part I §B: exporter/consignee, AD/CB, bank/IFSC — not port-of-loading or discharge fields. */
  sectionBDeclarant?: Record<string, string | null>;
  sectionCValueSummary?: Record<string, string | null>;
  sectionDExportPromotion?: Record<string, string | null>;
  sectionEManifest?: Record<string, string | null>;
  /** F. INVOICE SUMMARY — one object per invoice row */
  sectionFInvoiceSummary?: Part1InvoiceSummaryRow[];
  /** G. EQUIPMENT DETAILS */
  sectionGEquipmentDetails?: Part1EquipmentRow[];
  /** H. CHALLAN DETAILS */
  sectionHChallanDetails?: Part1ChallanRow[];
  sectionIAnnex?: Record<string, string | null>;
  /** J. PROCESS DETAILS — log lines; use one array element per event row if tabular */
  sectionJProcessDetails?: Record<string, string | null>[] | Record<string, string | null>;
}

/** Part II — A and D are repeating; B/C are usually single blocks but may repeat if multiple invoices. */
export interface Part2SectionARefRow {
  sno?: string | null;
  invoiceNoAndDate?: string | null;
  poNoAndDate?: string | null;
  locNoAndDate?: string | null;
  contractNoAndDate?: string | null;
  adCode?: string | null;
  invterm?: string | null;
}

export interface Part2SectionDItemRow {
  itemSno?: string | null;
  hsCd?: string | null;
  description?: string | null;
  quantity?: string | null;
  uqc?: string | null;
  rate?: string | null;
  valueFc?: string | null;
}

export interface Part2InvoiceDetails {
  sectionARef?: Part2SectionARefRow[];
  sectionBTransactionParties?: Record<string, string | null>;
  /** One row per invoice if multiple; else single object in [0] or flat object — model should prefer array */
  sectionCValuation?: Record<string, string | null>[] | Record<string, string | null>;
  sectionDItemDetails?: Part2SectionDItemRow[];
}

/** Part III — one array element per item (each item is a logical block on the PDF). */
export interface Part3ItemDetailRow {
  invsn?: string | null;
  itemsn?: string | null;
  hsCd?: string | null;
  description?: string | null;
  quantity?: string | null;
  uqc?: string | null;
  rate?: string | null;
  valueFc?: string | null;
  fobInr?: string | null;
  pmv?: string | null;
  dutyAmt?: string | null;
  cessRt?: string | null;
  cesAmt?: string | null;
  dbkclmd?: string | null;
  igstStat?: string | null;
  igstValue?: string | null;
  igstAmount?: string | null;
  schcod?: string | null;
  schemeDescription?: string | null;
  sqcMsr?: string | null;
  sqcUqc?: string | null;
  stateOfOrigin?: string | null;
  districtOfOrigin?: string | null;
  ptAbroad?: string | null;
  compCess?: string | null;
  endUse?: string | null;
  ftaBenefitAvailed?: string | null;
  rewardBenefit?: string | null;
  thirdPartyItem?: string | null;
}

/** Part IV — each lettered table is list-shaped; empty PDFs → []. */
export interface Part4DrawbackRoslRow {
  invSno?: string | null;
  itemSno?: string | null;
  dbkSno?: string | null;
  qtyWt?: string | null;
  value?: string | null;
  rate?: string | null;
  dbkAmt?: string | null;
  stalev?: string | null;
  cenlev?: string | null;
  rosctlAmt?: string | null;
}

export interface Part4SingleWindowRow {
  invsn?: string | null;
  itmsn?: string | null;
  info?: string | null;
  qualifier?: string | null;
  infoCd?: string | null;
  infoText?: string | null;
  infoMsr?: string | null;
  uqc?: string | null;
}

export interface Part4SupportingDocRow {
  doctpcd?: string | null;
  icegateId?: string | null;
  irn?: string | null;
  [key: string]: string | null | undefined;
}

export interface Part4RodtepRow {
  invsn?: string | null;
  itmsn?: string | null;
  quantity?: string | null;
  uqc?: string | null;
  noOfUnits?: string | null;
  value?: string | null;
}

export interface Part4ExportSchemeDetails {
  sectionADrawbackRosl?: Part4DrawbackRoslRow[];
  sectionBAaDfiaLicence?: Record<string, string | null>[];
  sectionCJobbing?: Record<string, string | null>[];
  sectionDSingleWindowDeclaration?: Part4SingleWindowRow[];
  sectionEConstituents?: Record<string, string | null>[];
  sectionFControl?: Record<string, string | null>[];
  sectionGSupportingDocuments?: Part4SupportingDocRow[];
  sectionHInvoiceDetails?: Record<string, string | null>[];
  sectionIContainer?: Record<string, string | null>[];
  sectionJAr4?: Record<string, string | null>[];
  sectionKThirdParty?: Record<string, string | null>[];
  sectionLManufacturer?: Record<string, string | null>[];
  sectionMRodtep?: Part4RodtepRow[];
  sectionNReexport?: Record<string, string | null>[];
}

export interface Part5Declarations {
  declarationStatement?: string | string[] | null;
  authorizedSignatory?: Record<string, string | null>;
}

/** Root payload returned by structured Gemini extraction. */
export interface ShippingBillStructuredExtraction {
  source: "Gemini";
  documentType: "Shipping Bill";
  part1ShippingBillSummary?: Part1ShippingBillSummary;
  part2InvoiceDetails?: Part2InvoiceDetails;
  part3ItemDetails?: Part3ItemDetailRow[];
  part4ExportSchemeDetails?: Part4ExportSchemeDetails;
  part5Declarations?: Part5Declarations;
}
