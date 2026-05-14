/**
 * Prompt for hierarchical Shipping Bill extraction (Parts I–V, repeating tables as arrays).
 */

const JSON_SHAPE = `{
  "source": "Gemini",
  "documentType": "Shipping Bill",
  "part1ShippingBillSummary": {
    "metadata": { "portCode": "", "portName": "", "sbNo": "", "sbDate": "", "iecBr": "", "gstinType": "", "cbCode": "", "invCount": "", "itemCount": "", "contCount": "", "pkgCount": "", "grossWeightKgs": "" },
    "sectionAStatus": {
      "mode": "", "assess": "", "exmn": "", "jobbing": "", "meis": "", "dbk": "", "rodtp": "", "licence": "", "dfrc": "", "reExp": "", "lut": "",
      "portOfLoading": "", "stateOfOrigin": "", "portOfDischarge": "", "countryOfFinalDestination": "", "portOfFinalDestination": "", "countryOfDischarge": ""
    },
    "sectionBDeclarant": {
      "exporterNameAndAddress": "", "type": "", "adCode": "", "rbiWaiverNoAndDt": "", "cbName": "", "aeo": "",
      "consigneeNameAndAddress": "", "gstinType": "", "forexBankAcNo": "", "dbkBankAcNo": "", "ifscNo": ""
    },
    "sectionCValueSummary": { },
    "sectionDExportPromotion": { },
    "sectionEManifest": { },
    "sectionFInvoiceSummary": [ { "sno": "", "invNo": "", "invAmt": "", "currency": "" } ],
    "sectionGEquipmentDetails": [ { "container": "", "seal": "", "date": "", "sNo": "" } ],
    "sectionHChallanDetails": [ { "srNo": "", "challanNo": "", "paymentDate": "", "amount": "" } ],
    "sectionIAnnex": { },
    "sectionJProcessDetails": [ { "event": "", "dateTime": "", "detail": "" } ]
  },
  "part2InvoiceDetails": {
    "sectionARef": [ { "sno": "", "invoiceNoAndDate": "", "poNoAndDate": "", "locNoAndDate": "", "contractNoAndDate": "", "adCode": "", "invterm": "" } ],
    "sectionBTransactionParties": { "exporterNameAndAddress": "", "buyerNameAndAddress": "", "thirdPartyNameAndAddress": "", "buyerAeoStatus": "" },
    "sectionCValuation": [ { "invoiceValue": "", "fobValue": "", "freight": "", "insurance": "", "discounts": "", "commission": "", "deduct": "", "pc": "", "exchangeRate": "" } ],
    "sectionDItemDetails": [ { "itemSno": "", "hsCd": "", "description": "", "quantity": "", "uqc": "", "rate": "", "valueFc": "" } ]
  },
  "part3ItemDetails": [
    {
      "invsn": "", "itemsn": "", "hsCd": "", "description": "", "quantity": "", "uqc": "", "rate": "", "valueFc": "", "fobInr": "", "pmv": "",
      "dutyAmt": "", "cessRt": "", "cesAmt": "", "dbkclmd": "", "igstStat": "", "igstValue": "", "igstAmount": "", "schcod": "",
      "schemeDescription": "", "sqcMsr": "", "sqcUqc": "", "stateOfOrigin": "", "districtOfOrigin": "",
      "ptAbroad": "", "compCess": "", "endUse": "", "ftaBenefitAvailed": "", "rewardBenefit": "", "thirdPartyItem": ""
    }
  ],
  "part4ExportSchemeDetails": {
    "sectionADrawbackRosl": [ { "invSno": "", "itemSno": "", "dbkSno": "", "qtyWt": "", "value": "", "rate": "", "dbkAmt": "", "stalev": "", "cenlev": "", "rosctlAmt": "" } ],
    "sectionBAaDfiaLicence": [ { } ],
    "sectionCJobbing": [ { } ],
    "sectionDSingleWindowDeclaration": [ { "invsn": "", "itmsn": "", "info": "", "qualifier": "", "infoCd": "", "infoText": "", "infoMsr": "", "uqc": "" } ],
    "sectionEConstituents": [ { } ],
    "sectionFControl": [ { } ],
    "sectionGSupportingDocuments": [ { "doctpcd": "", "icegateId": "", "irn": "" } ],
    "sectionHInvoiceDetails": [ { "invoiceNo": "", "invoiceAmount": "", "currency": "" } ],
    "sectionIContainer": [ { } ],
    "sectionJAr4": [ { } ],
    "sectionKThirdParty": [ { } ],
    "sectionLManufacturer": [ { } ],
    "sectionMRodtep": [ { "invsn": "", "itmsn": "", "quantity": "", "uqc": "", "noOfUnits": "", "value": "" } ],
    "sectionNReexport": [ { } ]
  },
  "part5Declarations": {
    "declarationStatement": "",
    "authorizedSignatory": { "date": "", "place": "", "authorizedSignatory": "", "chaName": "" }
  }
}`;

export function buildStructuredShippingBillPrompt(): string {
  return `You are a precision extractor for Indian ICEGATE **Shipping Bill** PDFs (LEO / exporter copy).

UNIVERSAL EXTRACTION RULES:
- SCAN ALL PAGES: Read every page of the PDF from first to last. Fields and tables appear across multiple pages.
- POSITION-AGNOSTIC: Labels may appear in any layout — top-right blocks, inline key:value pairs, left/right columns, headers, footers. Do not assume a fixed position for any field.
- NEVER TRUNCATE ARRAYS: For every table/array section, extract ALL rows from ALL pages. Do not stop after the first page or first few rows.
- FUZZY LABEL MATCHING: Labels may be abbreviated or worded differently — match semantically (e.g. "S.B. No" = "sbNo", "Gross Wt" = "grossWeightKgs", "Inv Amt" = "invAmt").

STRUCTURE (critical):
- The form is organized as **Part I** (summary), **Part II** (invoice details), **Part III** (item details), **Part IV** (export scheme / licences / RoDTEP / supporting docs), **Part V** (declarations).
- **Part I — Section A (STATUS)** on the PDF includes: (1) MODE / ASSESS / EXMN / JOBBING / MEIS / DBK / RODTP / LICENCE / DFRC / RE-EXP / LUT flags, and (2) **logistics lines printed in that same A block**: PORT OF LOADING, STATE OF ORIGIN, PORT OF DISCHARGE / FINAL DESTINATION, COUNTRY OF FINAL DESTINATION, etc. Put **all of those** in \`sectionAStatus\` only — never under \`sectionBDeclarant\`.
- **Part I — Section B (DECLARANT DETAILS)** is exporter/consignee names and addresses, AD code, CB name, bank / Forex / DBK account / IFSC — **not** port of loading, discharge, or country-of-destination fields (those belong in \`sectionAStatus\`).
- **Every tabular section must be a JSON array**, even if the PDF shows only one row or the table is empty (use []).
- **Part III**: one object in \`part3ItemDetails\` per **item line** on the document (same count as ITEM count in the header when possible).
- **Part II section D** and **Part IV** sections A, D, G, H, M, etc. can have **multiple rows** — capture **all** rows; do not collapse tables into a single string.
- Single-value blocks (e.g. Part II section B) are **objects**, not arrays.
- Use **exact printed text** for values (trim outer whitespace only). Use null for missing optional string fields if needed.
- Fill every key shown in the template below; use null or "" or [] as appropriate. Add **extra keys** on objects if the PDF has labeled fields not listed (preserve label names in camelCase).

Output **one JSON object** only (no markdown fences). Keys and nesting **must** follow this shape (values are examples — replace from the PDF):

${JSON_SHAPE}`;
}
