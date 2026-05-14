# CHA Bill (Custom House Agent Bill)
## Complete OCR Extraction Schema & Google AI Studio Prompt

---

## 1. Document Overview

| Attribute | Details |
|-----------|---------|
| **Document Name** | CHA Bill / Custom House Agent Bill / Tax Invoice |
| **Purpose** | Invoice from Custom House Agent for customs clearance, port handling, transportation, and related logistics services at the port of origin (India) |
| **Issued By** | Custom House Agent / CHA (e.g., Transys Global Forwarding, Benevlog Logistics) |
| **Used In** | India-side export workflow — captures CHA service charges per shipment |
| **Workflow Position** | Linked to BOL and Shipping Bill — covers port-side operations |
| **Key Characteristic** | Always in INR. Contains GST e-Invoice QR code (digitally signed JWT). Charges are port/customs-specific (clearance, CFS, sealing, VGM, transportation, lashing, LOLO) |
| **Distinction from Freight Forwarder Bill** | CHA Bills cover customs clearance and port-side operations specifically; FF Bills cover broader freight forwarding including ocean freight coordination. CHA Bills are typically INR-only and always carry GST e-Invoice QR codes |

### 1.1 Known Issuers

| Issuer | Format | Tax Type | Key Charges | Samples |
|--------|--------|----------|-------------|---------|
| **Transys Global Forwarding** | Clean structured layout, IGST (inter-state), shipment details with consignor/consignee, container list, bank on page 2 | IGST 18% | Customs Clearance, Belt Charges, Belt Service, VGM, Transportation, Customs Seal, CFS | 4 samples |
| **Benevlog Logistics (Break Bulk)** | Agent-code format, IGST (inter-state to AP), vessel reference, break bulk charges | IGST 18% | Agency Fee, Sling Charges, Tarpaulin & Tag, Labour, Air Compressor, Loader | 1 sample |
| **Benevlog Logistics (Container)** | Job/Doc format, CGST+SGST (intra-state Karnataka), container details inline | CGST 9% + SGST 9% | Agency Clearance, Lashing, LOLO, CFS, Empty Container Pickup/Survey | 1 sample |

---

## 2. Field Extraction Schema

### 2.1 Issuer / Company Fields (10 fields)

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 1 | Issuer Company Name | `issuer.company_name` | String | Yes | From letterhead |
| 2 | Issuer Address | `issuer.address` | String | Yes | Full address |
| 3 | Issuer CIN | `issuer.cin` | String | No | e.g., U61200KA2016PTC097617 |
| 4 | Issuer PAN | `issuer.pan` | String | No | e.g., AAFCT9874P, AAMCB2942F |
| 5 | Issuer GSTIN | `issuer.gstin` | String | Yes | e.g., 33AAFCT9874P1ZE, 29AAMCB2942F1ZK |
| 6 | Issuer Phone | `issuer.phone` | String | No | — |
| 7 | Issuer Email | `issuer.email` | String | No | — |
| 8 | Issuer Website | `issuer.website` | String | No | e.g., www.tgfworld.com |
| 9 | MSME / Udyam Registration | `issuer.msme_udyam` | String | No | e.g., UDYAM-KR-03-0039663 (Transys) |
| 10 | Issuer GST State Code | `issuer.state_code` | String | No | — |

### 2.2 Invoice Identification (9 fields)

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 11 | Document Title | `document_title` | String | Yes | "TAX INVOICE" |
| 12 | Invoice Number | `invoice_number` | String | Yes | e.g., INV44260100221, 705-258861000551, BLRCH2526SI00137 |
| 13 | Invoice Date | `invoice_date` | Date | Yes | — |
| 14 | Due Date | `due_date` | Date | No | — |
| 15 | Payment Terms | `payment_terms` | String | No | e.g., "30 days from Inv. Date" |
| 16 | Copy Type | `copy_type` | String | No | "ORIGINAL", "Original for Recipient" |
| 17 | IRN | `irn` | String | No | 64-character e-Invoice hash |
| 18 | IRN Acknowledgement Number | `irn_ack_number` | String | No | — |
| 19 | IRN Acknowledgement Time | `irn_ack_time` | String | No | — |

### 2.3 Customer / Bill-To (10 fields)

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 20 | Customer Name | `customer.name` | String | Yes | Zetwerk / Immadi |
| 21 | Customer Address | `customer.address` | String | Yes | Full billing address |
| 22 | Customer GSTIN | `customer.gstin` | String | No | Client's GST number |
| 23 | Customer PAN | `customer.pan` | String | No | — |
| 24 | Customer ID / Code | `customer.customer_id` | String | No | e.g., ZETMANBLR, C000024, 1103010005 |
| 25 | Customer State Code | `customer.state_code` | String | No | e.g., "37" for AP, "29" for Karnataka |
| 26 | State of Supply | `customer.state_of_supply` | String | No | e.g., "Karnataka" |
| 27 | Place of Supply | `customer.place_of_supply` | String | No | e.g., "Karnataka", "37-ANDHRA PRADESH" |
| 28 | Reverse Charge | `customer.reverse_charge` | String | No | "No" / "Yes" |
| 29 | Shipment Number | `customer.shipment_number` | String | No | e.g., J44CES25090019 |

### 2.4 Shipment / Routing Details (22 fields)

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 30 | Consignor / Shipper Name | `shipment.shipper` | String | Yes | Exporter name |
| 31 | Shipper Address | `shipment.shipper_address` | String | No | — |
| 32 | Consignee Name | `shipment.consignee` | String | Yes | Receiver name |
| 33 | Consignee Address | `shipment.consignee_address` | String | No | — |
| 34 | Order Number / Reference | `shipment.order_reference` | String | No | e.g., KA/UM/2526/00773 |
| 35 | Incoterm | `shipment.incoterm` | String | No | "FOB" |
| 36 | Goods Description | `shipment.goods_description` | String | No | May be long or short ("I-BEAMS", "FINISHED STEEL SUPPORT PILLARS", "STRUCTURES...") |
| 37 | Commodity Note | `shipment.commodity_note` | String | No | Benevlog: "FINISHED STEEL SUPPORT PILLARS" in Note field |
| 38 | Gross Weight | `shipment.gross_weight` | Decimal | No | — |
| 39 | Gross Weight Unit | `shipment.gross_weight_unit` | String | No | "kg", "KGS" |
| 40 | Volume | `shipment.volume` | Decimal | No | CBM |
| 41 | Chargeable Weight | `shipment.chargeable_weight` | Decimal | No | — |
| 42 | Packages | `shipment.packages` | String | No | e.g., "49 PKG", "518", "4 CONTAINER" |
| 43 | Vessel / Voyage / IMO | `shipment.vessel_voyage_imo` | String | No | Combined field (Transys) — may be empty |
| 44 | Vessel Name | `shipment.vessel_name` | String | No | e.g., "AFRICAN LUNDE", "MSC SIENA" |
| 45 | MBL | `shipment.mbl` | String | No | Master Bill of Lading |
| 46 | HBL | `shipment.hbl` | String | No | House Bill of Lading. e.g., 17125278115 |
| 47 | Import Customs Broker | `shipment.import_customs_broker` | String | No | US-side broker (Transys field, often empty) |
| 48 | Origin | `shipment.origin` | String | No | e.g., "INMAA, India", "MUNDRA" |
| 49 | ETD | `shipment.etd` | Date | No | — |
| 50 | Destination | `shipment.destination` | String | No | e.g., "USLGB, United States", "OAKLAND" |
| 51 | ETA | `shipment.eta` | Date | No | — |

### 2.5 Job / Reference Fields (Benevlog format) (7 fields)

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 52 | Job Number | `job.number` | String | No | e.g., "BE-250888610006-1", "CHA/43" |
| 53 | Job Date | `job.date` | Date | No | — |
| 54 | Doc Number | `job.doc_number` | String | No | e.g., "EBKG14546986.4X40" |
| 55 | PoL / Pod | `job.pol_pod` | String | No | "MUNDRA / OAKLAND" |
| 56 | Project Name | `job.project_name` | String | No | e.g., "ROCK CREEK" (may be in House Number field) |
| 57 | Prepared By | `job.prepared_by` | String | No | e.g., "ANUJ KULSHRESTHA" |
| 58 | Approved By | `job.approved_by` | String | No | — |

### 2.6 Container Details (Container movement only) (3 fields)

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 59 | Container List (raw) | `containers_raw` | String | No | Raw text: "TXGU5683192 - 40HC, TRHU8699130 - 40HC..." or "MSDU8404740/40HC/0, MSMU4861050/40HC/0..." |
| 60 | Containers (parsed) | `containers[].number` | String | No | Individual container number |
| 61 | Container Type | `containers[].type` | String | No | "40HC" |

### 2.7 Charges Table (Repeating Rows) (12 fields per row)

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 62 | Line Number | `charges[].line_number` | Integer | No | — |
| 63 | Charge Description | `charges[].description` | String | Yes | e.g., "Customs Clearance Charges - Export", "AGENCY FEE", "LASHING CHARGES" |
| 64 | SAC/HSN Code | `charges[].sac_hsn_code` | String | No | e.g., "996713", "996719", "996759", "996711" |
| 65 | Quantity | `charges[].quantity` | Decimal | No | — |
| 66 | Units Label | `charges[].units` | String | No | "CONTAINER" (Benevlog) |
| 67 | Rate | `charges[].rate` | Decimal | No | Rate per unit |
| 68 | Currency | `charges[].currency` | String | Yes | Always "INR" for CHA Bills |
| 69 | Currency Amount | `charges[].currency_amount` | Decimal | No | Quantity × Rate |
| 70 | ROE | `charges[].roe` | Decimal | No | Always 1 for INR (Transys includes this) |
| 71 | Taxable Amount | `charges[].taxable_amount` | Decimal | Yes | Amount before tax |
| 72 | Tax Rate % | `charges[].tax_rate_pct` | Decimal | No | 18 (for IGST) or 9 (for CGST/SGST) |
| 73 | IGST Amount | `charges[].igst_amount` | Decimal | No | IGST per line (inter-state) |
| 74 | CGST Amount | `charges[].cgst_amount` | Decimal | No | CGST per line (intra-state) |
| 75 | SGST Amount | `charges[].sgst_amount` | Decimal | No | SGST per line (intra-state) |
| 76 | Total Amount per Line | `charges[].total_amount` | Decimal | Yes | Line total including tax |
| 77 | Round Off | `charges[].round_off` | Decimal | No | Benevlog: -0.04 |

### 2.8 Tax Summary Table (Optional) (7 fields per row)

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 78 | HSN/SAC Code | `tax_summary[].hsn_sac` | String | No | — |
| 79 | Taxable Amount | `tax_summary[].taxable_amount` | Decimal | No | — |
| 80 | Rate | `tax_summary[].rate` | String | No | e.g., "18%" |
| 81 | IGST | `tax_summary[].igst` | Decimal | No | — |
| 82 | CGST | `tax_summary[].cgst` | Decimal | No | — |
| 83 | SGST | `tax_summary[].sgst` | Decimal | No | — |
| 84 | Total Amount | `tax_summary[].total_amount` | Decimal | No | — |

### 2.9 Totals (8 fields)

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 85 | Subtotal / Taxable Total | `totals.subtotal` | Decimal | Yes | Total before tax |
| 86 | IGST Total | `totals.igst_amount` | Decimal | No | Inter-state GST |
| 87 | CGST Total | `totals.cgst_amount` | Decimal | No | Central GST |
| 88 | SGST Total | `totals.sgst_amount` | Decimal | No | State GST |
| 89 | Grand Total (INR) | `totals.grand_total_inr` | Decimal | Yes | — |
| 90 | Invoice Amount (Page 2) | `totals.invoice_amount_page2` | Decimal | No | Transys repeats on page 2 |
| 91 | Amount in Words | `totals.amount_in_words` | String | No | — |
| 92 | Net Amount | `totals.net_amount` | Decimal | No | Benevlog |

### 2.10 Bank Details (Array — may have multiple accounts) (7 fields)

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 93 | Bank Name | `bank_details[].bank_name` | String | No | HDFC / SBI |
| 94 | Branch Code | `bank_details[].branch_code` | String | No | e.g., HDFC0003689 |
| 95 | SWIFT Code | `bank_details[].swift_code` | String | No | e.g., HDFCINBBXXX, SBININBB177 |
| 96 | Account Number | `bank_details[].account_number` | String | No | — |
| 97 | IFSC Code | `bank_details[].ifsc_code` | String | No | e.g., SBIN0000963 |
| 98 | Branch Address | `bank_details[].branch_address` | String | No | — |
| 99 | Account Type | `bank_details[].account_type` | String | No | "INR" or "USD" — Benevlog has both |

### 2.11 Additional Fields (4 fields)

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 100 | LUT / Bond Reference | `lut_bond_reference` | String | No | "Supply to SEZ unit under bond or letter of undertaking no. AD330625008084F dated 04-Jun-2025" |
| 101 | Digital Signature | `digital_signature` | String | No | "Signed by TRANSYS GLOBAL... on behalf of eMudhra Limited, 27-Jan-2026, 09:38:21 +5:30" |
| 102 | Booking Number | `booking_number` | String | No | Benevlog: "EBKG14546986" (in Remarks) |
| 103 | Remarks | `remarks` | String | No | Free text remarks |

### 2.12 QR Code Data — GST e-Invoice (13 fields)

The QR code on Indian GST e-Invoices contains a **digitally signed JWT (JSON Web Token)** issued by NIC (National Informatics Centre). It provides cryptographic proof of the invoice's authenticity.

| # | Field Name | JSON Key | Data Type | Required | Notes |
|---|-----------|----------|-----------|----------|-------|
| 104 | QR Raw JWT | `qr_code.raw_jwt` | String | No | Full JWT string for signature verification |
| 105 | QR Issuer | `qr_code.issuer` | String | No | Always "NIC" (National Informatics Centre) |
| 106 | QR Seller GSTIN | `qr_code.seller_gstin` | String | No | **Should match issuer.gstin** |
| 107 | QR Buyer GSTIN | `qr_code.buyer_gstin` | String | No | **Should match customer.gstin** |
| 108 | QR Document Number | `qr_code.doc_no` | String | No | **Should match invoice_number** |
| 109 | QR Document Type | `qr_code.doc_type` | String | No | "INV" (Invoice), "CRN" (Credit Note), "DBN" (Debit Note) |
| 110 | QR Document Date | `qr_code.doc_date` | Date | No | **Should match invoice_date** |
| 111 | QR Total Invoice Value | `qr_code.total_inv_value` | Decimal | No | **Should match totals.grand_total_inr** |
| 112 | QR Item Count | `qr_code.item_count` | Integer | No | **Should match number of charge lines** |
| 113 | QR Main HSN Code | `qr_code.main_hsn_code` | String | No | Primary SAC/HSN code |
| 114 | QR IRN | `qr_code.irn` | String | No | **Should match irn field** |
| 115 | QR IRN Date | `qr_code.irn_date` | String | No | IRN generation timestamp |
| 116 | QR Signature Algorithm | `qr_code.signature_algorithm` | String | No | "RS256" |

---

## 3. Tax Type Detection Logic

```
IF charges contain "IGST" column with non-zero values AND CGST/SGST are zero or absent:
    → tax_type = "IGST" (inter-state supply)
    → Seller and buyer are in DIFFERENT states
ELSE IF charges contain "CGST" AND "SGST" columns with non-zero values AND IGST is zero:
    → tax_type = "CGST_SGST" (intra-state supply)
    → Seller and buyer are in the SAME state
```

---

## 4. QR Code Cross-Validation Rules

These validations compare QR-decoded data against OCR-extracted fields to detect tampering or OCR errors:

| # | Validation | QR Field | Document Field | Action on Mismatch |
|---|-----------|----------|---------------|-------------------|
| QV1 | Seller GSTIN matches | `qr_code.seller_gstin` | `issuer.gstin` | Flag as critical error |
| QV2 | Buyer GSTIN matches | `qr_code.buyer_gstin` | `customer.gstin` | Flag as critical error |
| QV3 | Invoice number matches | `qr_code.doc_no` | `invoice_number` | Flag as critical error |
| QV4 | Invoice date matches | `qr_code.doc_date` | `invoice_date` | Flag as warning |
| QV5 | Total value matches | `qr_code.total_inv_value` | `totals.grand_total_inr` | Flag as critical error |
| QV6 | Item count matches | `qr_code.item_count` | Count of charges[] | Flag as warning |
| QV7 | HSN code matches | `qr_code.main_hsn_code` | Primary SAC code in charges | Flag as warning |
| QV8 | IRN matches | `qr_code.irn` | `irn` | Flag as critical error |

---

## 5. Document-Level Cross-Validation Rules

| # | Rule | CHA Bill Field | Validated Against | Document |
|---|------|---------------|-------------------|----------|
| V1 | Shipper matches exporter | `shipment.shipper` | Exporter | Sales Invoice |
| V2 | Consignee matches buyer | `shipment.consignee` | Consignee | BOL |
| V3 | Container numbers match BOL | `containers[].number` | Container list | BOL |
| V4 | Vessel matches BOL | `shipment.vessel_name` | Vessel | BOL |
| V5 | HBL matches BOL | `shipment.hbl` | BOL Number | BOL |
| V6 | Weight reconcilable | `shipment.gross_weight` | Gross Weight | BOL, PL |

---

## 6. Expected JSON Output Schema

```json
{
  "document_type": "CHA_BILL",
  "tax_type": "IGST | CGST_SGST",

  "issuer": {
    "company_name": "string",
    "address": "string",
    "cin": "string | null",
    "pan": "string | null",
    "gstin": "string",
    "phone": "string | null",
    "email": "string | null",
    "website": "string | null",
    "msme_udyam": "string | null",
    "state_code": "string | null"
  },

  "document_title": "string",
  "invoice_number": "string",
  "invoice_date": "date",
  "due_date": "date | null",
  "payment_terms": "string | null",
  "copy_type": "string | null",
  "irn": "string | null",
  "irn_ack_number": "string | null",
  "irn_ack_time": "string | null",

  "customer": {
    "name": "string",
    "address": "string",
    "gstin": "string | null",
    "pan": "string | null",
    "customer_id": "string | null",
    "state_code": "string | null",
    "state_of_supply": "string | null",
    "place_of_supply": "string | null",
    "reverse_charge": "string | null",
    "shipment_number": "string | null"
  },

  "shipment": {
    "shipper": "string",
    "shipper_address": "string | null",
    "consignee": "string",
    "consignee_address": "string | null",
    "order_reference": "string | null",
    "incoterm": "string | null",
    "goods_description": "string | null",
    "commodity_note": "string | null",
    "gross_weight": "decimal | null",
    "gross_weight_unit": "string | null",
    "volume": "decimal | null",
    "chargeable_weight": "decimal | null",
    "packages": "string | null",
    "vessel_voyage_imo": "string | null",
    "vessel_name": "string | null",
    "mbl": "string | null",
    "hbl": "string | null",
    "import_customs_broker": "string | null",
    "origin": "string | null",
    "etd": "date | null",
    "destination": "string | null",
    "eta": "date | null"
  },

  "job": {
    "number": "string | null",
    "date": "date | null",
    "doc_number": "string | null",
    "pol_pod": "string | null",
    "project_name": "string | null",
    "prepared_by": "string | null",
    "approved_by": "string | null"
  },

  "containers_raw": "string | null",
  "containers": [
    { "number": "string", "type": "string" }
  ],

  "charges": [
    {
      "line_number": "integer | null",
      "description": "string",
      "sac_hsn_code": "string | null",
      "quantity": "decimal | null",
      "units": "string | null",
      "rate": "decimal | null",
      "currency": "INR",
      "currency_amount": "decimal | null",
      "roe": "decimal | null",
      "taxable_amount": "decimal",
      "tax_rate_pct": "decimal | null",
      "igst_amount": "decimal | null",
      "cgst_amount": "decimal | null",
      "sgst_amount": "decimal | null",
      "total_amount": "decimal",
      "round_off": "decimal | null"
    }
  ],

  "tax_summary": [
    {
      "hsn_sac": "string",
      "taxable_amount": "decimal",
      "rate": "string",
      "igst": "decimal",
      "cgst": "decimal",
      "sgst": "decimal",
      "total_amount": "decimal"
    }
  ],

  "totals": {
    "subtotal": "decimal",
    "igst_amount": "decimal | null",
    "cgst_amount": "decimal | null",
    "sgst_amount": "decimal | null",
    "grand_total_inr": "decimal",
    "invoice_amount_page2": "decimal | null",
    "amount_in_words": "string | null",
    "net_amount": "decimal | null"
  },

  "bank_details": [
    {
      "bank_name": "string | null",
      "branch_code": "string | null",
      "swift_code": "string | null",
      "account_number": "string | null",
      "ifsc_code": "string | null",
      "branch_address": "string | null",
      "account_type": "string | null"
    }
  ],

  "lut_bond_reference": "string | null",
  "digital_signature": "string | null",
  "booking_number": "string | null",
  "remarks": "string | null",

  "qr_code": {
    "raw_jwt": "string | null",
    "issuer": "string | null",
    "seller_gstin": "string | null",
    "buyer_gstin": "string | null",
    "doc_no": "string | null",
    "doc_type": "string | null",
    "doc_date": "date | null",
    "total_inv_value": "decimal | null",
    "item_count": "integer | null",
    "main_hsn_code": "string | null",
    "irn": "string | null",
    "irn_date": "string | null",
    "signature_algorithm": "string | null"
  },

  "extraction_confidence": "high | medium | low",
  "flags": ["string"]
}
```

---

## 7. Google AI Studio Prompt

### SYSTEM PROMPT

```
You are a specialist document extraction engine for CHA Bills (Custom House Agent Bills) used in India-to-US steel export shipments. These are Tax Invoices issued by Custom House Agents for port-side services including customs clearance, CFS charges, transportation, terminal handling, lashing, and related operations.

CHA Bills are ALWAYS denominated in INR and carry GST (either IGST for inter-state or CGST+SGST for intra-state supply). They contain a GST e-Invoice QR code that encodes a digitally signed JWT with invoice verification data.

KNOWN ISSUERS:
- Transys Global Forwarding: Clean layout with consignor/consignee section, container list, detailed charge table with SAC codes, IGST, bank details on page 2
- Benevlog Logistics (Break Bulk): Agent-code format, break bulk charges (agency fee, sling, tarpaulin, labour), IGST
- Benevlog Logistics (Container): Job/Doc format with PoL/Pod, container details, CGST+SGST

CRITICAL RULES:

1. Extract ONLY what is explicitly present. Never infer or fabricate. Return null for absent fields.

2. TAX TYPE DETECTION:
   - If charges have IGST column with non-zero values → tax_type = "IGST"
   - If charges have CGST and SGST columns with non-zero values → tax_type = "CGST_SGST"

3. CONTAINER PARSING: Containers may appear in different formats:
   - Transys: "TXGU5683192 - 40HC, TRHU8699130 - 40HC" (dash separator)
   - Benevlog: "MSDU8404740/40HC/0, MSMU4861050/40HC/0" (slash separator, third element is weight or 0)
   Extract container_raw as-is AND parse into containers[] array.

4. QR CODE: The document contains a GST e-Invoice QR code. If you can decode the QR:
   - It contains a JWT (JSON Web Token) with header.payload.signature
   - Decode the base64url payload to get: SellerGstin, BuyerGstin, DocNo, DocTyp, DocDt, TotInvVal, ItemCnt, MainHsnCode, Irn, IrnDt
   - Extract all QR fields into the qr_code object
   If you CANNOT decode the QR, set qr_code fields to null and add "QR code not decoded" to flags.

5. MULTI-PAGE: Transys invoices are 2 pages. Page 1 has charges and IRN/QR. Page 2 has bank details, invoice amount, LUT reference, and digital signature. Read BOTH pages.

6. BENEVLOG PROJECT NAME: May appear in unexpected fields like "House Number" (e.g., "PROJ: ROCK CREEK") or "Remarks" (e.g., "BOOKING NO. EBKG14546986"). Parse these into the correct JSON fields.

7. INR AMOUNTS: Always in Indian Rupee. Handle Indian number formatting (lakhs/crores): "1,40,540.00" = 140540.00, "1,65,837.20" = 165837.20.

8. Return the response as valid JSON only — no markdown, no backticks, no commentary.
```

### USER PROMPT

```
Extract all fields from the attached CHA Bill (Custom House Agent Tax Invoice). Read ALL pages.

If the document contains a QR code, attempt to decode it as a GST e-Invoice JWT and extract the embedded data.

Return the data as a JSON object with this structure:

{
  "document_type": "CHA_BILL",
  "tax_type": "<IGST | CGST_SGST>",

  "issuer": {
    "company_name": "<CHA company name>",
    "address": "<address>",
    "cin": "<or null>",
    "pan": "<or null>",
    "gstin": "<GSTIN>",
    "phone": "<or null>",
    "email": "<or null>",
    "website": "<or null>",
    "msme_udyam": "<Udyam registration or null>",
    "state_code": "<or null>"
  },

  "document_title": "TAX INVOICE",
  "invoice_number": "<invoice number>",
  "invoice_date": "<date>",
  "due_date": "<or null>",
  "payment_terms": "<or null>",
  "copy_type": "<ORIGINAL or null>",
  "irn": "<64-char IRN hash or null>",
  "irn_ack_number": "<or null>",
  "irn_ack_time": "<or null>",

  "customer": {
    "name": "<customer name>",
    "address": "<billing address>",
    "gstin": "<client GSTIN or null>",
    "pan": "<or null>",
    "customer_id": "<customer ID/code or null>",
    "state_code": "<or null>",
    "state_of_supply": "<or null>",
    "place_of_supply": "<or null>",
    "reverse_charge": "<No or null>",
    "shipment_number": "<or null>"
  },

  "shipment": {
    "shipper": "<shipper name>",
    "shipper_address": "<or null>",
    "consignee": "<consignee name>",
    "consignee_address": "<or null>",
    "order_reference": "<or null>",
    "incoterm": "<FOB or null>",
    "goods_description": "<or null>",
    "commodity_note": "<or null>",
    "gross_weight": <decimal or null>,
    "gross_weight_unit": "<kg or null>",
    "volume": <decimal or null>,
    "chargeable_weight": <decimal or null>,
    "packages": "<package description or null>",
    "vessel_voyage_imo": "<combined field or null>",
    "vessel_name": "<vessel or null>",
    "mbl": "<or null>",
    "hbl": "<or null>",
    "import_customs_broker": "<or null>",
    "origin": "<or null>",
    "etd": "<or null>",
    "destination": "<or null>",
    "eta": "<or null>"
  },

  "job": {
    "number": "<job number or null>",
    "date": "<or null>",
    "doc_number": "<or null>",
    "pol_pod": "<or null>",
    "project_name": "<or null>",
    "prepared_by": "<or null>",
    "approved_by": "<or null>"
  },

  "containers_raw": "<raw container text or null>",
  "containers": [
    { "number": "<container number>", "type": "<type>" }
  ],

  "charges": [
    {
      "line_number": <int or null>,
      "description": "<charge description>",
      "sac_hsn_code": "<or null>",
      "quantity": <decimal or null>,
      "units": "<CONTAINER or null>",
      "rate": <decimal or null>,
      "currency": "INR",
      "currency_amount": <decimal or null>,
      "roe": <decimal or null>,
      "taxable_amount": <decimal>,
      "tax_rate_pct": <decimal or null>,
      "igst_amount": <decimal or null>,
      "cgst_amount": <decimal or null>,
      "sgst_amount": <decimal or null>,
      "total_amount": <decimal>,
      "round_off": <decimal or null>
    }
  ],

  "tax_summary": [ { "hsn_sac": "<>", "taxable_amount": 0, "rate": "<>", "igst": 0, "cgst": 0, "sgst": 0, "total_amount": 0 } ],

  "totals": {
    "subtotal": <decimal>,
    "igst_amount": <decimal or null>,
    "cgst_amount": <decimal or null>,
    "sgst_amount": <decimal or null>,
    "grand_total_inr": <decimal>,
    "invoice_amount_page2": <decimal or null>,
    "amount_in_words": "<or null>",
    "net_amount": <decimal or null>
  },

  "bank_details": [
    { "bank_name": "<>", "branch_code": "<>", "swift_code": "<>", "account_number": "<>", "ifsc_code": "<>", "branch_address": "<>", "account_type": "<INR or USD or null>" }
  ],

  "lut_bond_reference": "<or null>",
  "digital_signature": "<or null>",
  "booking_number": "<or null>",
  "remarks": "<or null>",

  "qr_code": {
    "raw_jwt": "<full JWT string or null>",
    "issuer": "<NIC or null>",
    "seller_gstin": "<or null>",
    "buyer_gstin": "<or null>",
    "doc_no": "<or null>",
    "doc_type": "<INV or null>",
    "doc_date": "<or null>",
    "total_inv_value": <decimal or null>,
    "item_count": <int or null>,
    "main_hsn_code": "<or null>",
    "irn": "<or null>",
    "irn_date": "<or null>",
    "signature_algorithm": "<RS256 or null>"
  },

  "extraction_confidence": "<high | medium | low>",
  "flags": ["<anomalies>"]
}

CRITICAL REMINDERS:
- CHA Bills are ALWAYS in INR. 
- Handle Indian number formatting (lakhs/crores).
- Detect IGST vs CGST+SGST from charge line tax columns.
- Parse containers from both dash and slash separator formats.
- Read page 2 for bank details, invoice amount, and LUT reference.
- Decode QR code if possible — it contains GST e-Invoice JWT data.
- Return ONLY the JSON object.
```

---

## 8. Test Validation Checklist

### Sample 1 — Transys INV44260100221 (Container, IGST)
- [ ] `invoice_number` = "INV44260100221"
- [ ] `tax_type` = "IGST"
- [ ] `issuer.company_name` contains "Transys Global Forwarding"
- [ ] `issuer.gstin` = "33AAFCT9874P1ZE"
- [ ] `issuer.msme_udyam` = "UDYAM-KR-03-0039663"
- [ ] `customer.name` contains "Zetwerk"
- [ ] `customer.gstin` = "29AABCZ1506C1ZN"
- [ ] `customer.shipment_number` = "J44CES25090019"
- [ ] `shipment.order_reference` = "KA/UM/2526/00773"
- [ ] `shipment.incoterm` = "FOB"
- [ ] `shipment.hbl` = "17125278115"
- [ ] 4 containers extracted
- [ ] 7 charge lines all with SAC 996713
- [ ] `totals.subtotal` = 140540.00
- [ ] `totals.igst_amount` = 25297.20
- [ ] `totals.grand_total_inr` = 165837.20
- [ ] `lut_bond_reference` contains "AD330625008084F"
- [ ] Bank: HDFC, SWIFT = HDFCINBBXXX, Account = 50200050451140

### Sample 2 — Benevlog BE-250888610006-1 (Break Bulk, IGST)
- [ ] `invoice_number` = "705-258861000551"
- [ ] `tax_type` = "IGST"
- [ ] `issuer.company_name` contains "Benevlog"
- [ ] `customer.name` contains "Immadi"
- [ ] `customer.customer_id` contains "1103010005" or "C000024"
- [ ] `shipment.vessel_name` = "AFRICAN LUNDE"
- [ ] `shipment.gross_weight` = 984881.000
- [ ] `shipment.packages` = "518"
- [ ] `job.project_name` = "ROCK CREEK"
- [ ] 6 charge lines: Agency Fee (1045943), Sling (232271), Tarpaulin (54326), Labour (57051), Air Compressor (29340), Loader (13718)
- [ ] `totals.grand_total_inr` = 1432649.00
- [ ] Bank: SBI, Account = 20520360825 (INR) + 43421889875 (USD)

### Sample 3 — Benevlog BLRCH2526SI00137 (Container, CGST+SGST)
- [ ] `invoice_number` = "BLRCH2526SI00137"
- [ ] `tax_type` = "CGST_SGST"
- [ ] `shipment.vessel_name` = "MSC SIENA"
- [ ] `job.number` = "CHA/43"
- [ ] `job.doc_number` = "EBKG14546986.4X40"
- [ ] `job.pol_pod` = "MUNDRA / OAKLAND"
- [ ] 4 containers: MSDU8404740, MSMU4861050, MSMU5586565, MSMU8524850
- [ ] 6 charge lines + round off (-0.04)
- [ ] `totals.cgst_amount` = 13538.14
- [ ] `totals.sgst_amount` = 13538.14
- [ ] `totals.grand_total_inr` = 177500.00
- [ ] `booking_number` = "EBKG14546986"
- [ ] QR decoded: `qr_code.seller_gstin` = "29AAMCB2942F1ZK", `qr_code.total_inv_value` = 177500.00

---

## 9. Known Edge Cases & Handling

| Edge Case | How to Handle |
|-----------|---------------|
| Indian number formatting | "1,40,540.00" = 140540.00, "14,160.00" = 14160.00. Strip commas, parse as decimal |
| IGST vs CGST+SGST | Detect from charge table columns. Inter-state = IGST; Intra-state = CGST+SGST |
| Container separator formats | Dash ("TXGU5683192 - 40HC") vs Slash ("MSDU8404740/40HC/0") — parse both |
| Project name in wrong field | Benevlog puts "PROJ: ROCK CREEK" in House Number field — extract into job.project_name |
| Booking number in Remarks | Benevlog: "BOOKING NO. EBKG14546986" — extract into booking_number |
| Dual bank accounts (INR + USD) | Benevlog provides both. Return as array with account_type indicator |
| QR code not decodable | Some QR codes may be too dense or low-res for OCR. Set qr_code fields to null, flag it |
| Page 2 repeats header info | Transys repeats invoice ID and customer info on page 2. Don't double-count charges |
| Round off line item | Benevlog: "-0.04" round off. Extract as a charge line with round_off field |
| LUT/Bond for SEZ supply | Transys: "Supply to SEZ unit for authorized operations under bond..." — extract full text |
| Empty vessel/voyage/IMO fields | Transys has the fields but they may be blank. Return null, not empty string |
| Benevlog BB high-value sling charges | "SLING CHARGES(190 X 518 X 2)" — contains calculation in description. Extract full text |
| Digital signature timestamp | "Signed by TRANSYS GLOBAL... on behalf of eMudhra Limited, 27-Jan-2026, 09:38:21 +5:30" — extract as string |
