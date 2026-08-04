import { DOC_FIELD_CONFIG, FieldDef } from './docFieldConfig';

export const DOC_CODE_TO_CONFIG_KEY: Record<string, string> = {
  CH: 'CHA_BILL',
  FF: 'FREIGHT_FORWARDER_BILL',
  BL: 'BILL_OF_LADING',
  SI: 'SALES_INVOICE',
  BE: 'ENTRY_SUMMARY',
  OF: 'OCEAN_FREIGHT',
  CR: 'US_CARGO_RELEASE_ORDER',
  BB: 'CUSTOMER_BROKER_BILL',
  DO: 'US_DELIVERY_ORDER',
  UC: 'US_CUSTOMS_RELEASE_ORDER',
  PT: 'PORT_TO_WH',
  SB: 'SHIPPING_BILL',
  IS: 'ENTRY_SUMMARY',
  GR: 'GRN_INBOUND',
  WC: 'WH_TO_CUSTOMER',
  PL: 'PACKING_LIST',
  UP: 'US_PACKING_LIST',
  UI: 'US_SALES_INVOICE',
  MC: 'PACKING_LIST',
};

export type MockField = {
  key: string;
  label: string;
  value: string;
  confidence: number;
  mono?: boolean;
  critical?: boolean;
};

export type MockSection = {
  sectionLabel: string;
  fields: MockField[];
};

export interface CardCtx {
  issuer: string;
  docNumber: string;
  context: string;
  avgConfidence: number;
}

function sid(ctx: CardCtx): string {
  return (ctx.context.match(/Shipment:\s*(\S+)/) ?? [])[1] ?? 'TCL25260084';
}

function h(s: string): number {
  let v = 5381;
  for (const c of s) v = ((v << 5) + v) ^ c.charCodeAt(0);
  return Math.abs(v);
}

function vessel(ctx: CardCtx): string {
  const id = sid(ctx);
  if (id.startsWith('SMAA')) return 'MV MAERSK LEBU';
  if (id.startsWith('MURG')) return 'MV AFRICAN LEOPARD 2';
  return 'MV ESL DACHAN BAY';
}

function isUS(ctx: CardCtx): boolean {
  return /gate (3|4|5)/i.test(ctx.context) || /US/.test(ctx.context);
}

function genValue(field: FieldDef, ctx: CardCtx): string {
  const k = field.key.toLowerCase();
  const id = sid(ctx);

  // ── Primary document IDs ─────────────────────────────────────────
  if (/^(invoice|bol|sb|sbno|entrynumber|grn|deliveryorder|filercodeentrynumber)/.test(k) &&
      /no$|number$/.test(k)) return ctx.docNumber;
  if (k === 'bolnumber' || k === 'shipmentreferencenumber') return ctx.docNumber;

  // ── Dates ────────────────────────────────────────────────────────
  if (/date|time/.test(k)) {
    if (/due|eta/.test(k)) return '26-Feb-2026';
    if (/etd|shipped|onboard/.test(k)) return '15-Jan-2026';
    if (/grn|receipt|appointment/.test(k)) return '15-Feb-2026';
    if (/leo|ack|charter/.test(k)) return '20-Jan-2026';
    if (/issue|invoice/.test(k)) return '27-Jan-2026';
    return '10-Jan-2026';
  }
  if (k === 'etd') return '15-Jan-2026';
  if (k === 'eta') return '26-Feb-2026';

  // ── Vessel / Voyage ──────────────────────────────────────────────
  if (/vessel/.test(k) || k === 'vesselflightno') return vessel(ctx);
  if (/voyage/.test(k)) return '0035W';

  // ── Ports / Route ────────────────────────────────────────────────
  if (/portofloading|loadingport/.test(k) || k === 'portofloading') return 'JNPT, Nhava Sheva';
  if (/portofdischarge|dischargingport/.test(k)) return 'Los Angeles, CA';
  if (k === 'portname') return 'JNPT, Nhava Sheva';
  if (k === 'portcode') return 'INJNP6';
  if (/countryoforigin/.test(k)) return 'India';
  if (/country/.test(k)) return 'United States of America';
  if (/finaldestination/.test(k)) return 'Los Angeles, CA, USA';
  if (/placeofreceipt|placeofacceptance|placeofdelivery/.test(k)) return 'Chennai ICD';
  if (/transhipmentplace/.test(k)) return 'Singapore';
  if (/incoterm/.test(k)) return 'CFR Los Angeles';
  if (/issuanceplace/.test(k)) return 'Singapore';
  if (/issuancedate/.test(k)) return '21-Jan-2026';

  // ── Weights / Cargo ──────────────────────────────────────────────
  if (/grossweight/.test(k) && !/unit/.test(k)) return '97,873 kg';
  if (/netweight/.test(k) && !/unit/.test(k)) return '95,240 kg';
  if (/weightlbs/.test(k)) return '215,659 lbs';
  if (/weightunit|grossweightunit/.test(k) || k.endsWith('unit')) return 'KGS';
  if (/totalpackages|pkgcount|packagecount/.test(k)) return '48';
  if (/totalbundles|bundlesaggregate/.test(k)) return '48';
  if (/totalcontainers|contcount/.test(k)) return '2';
  if (/totalqty|totalquantity|piecesaggregate/.test(k)) return '2,400';
  if (/cbm|measurement/.test(k)) return '61.52 CBM';
  if (/containerno|containerref/.test(k)) return 'TXGU5683192';
  if (/sealnumber|sealnum/.test(k)) return 'SL12345678';
  if (/packagedescription|marksandnumbers|marks/.test(k)) return `ZETWERK / ${id} / 1-48`;
  if (/packagesummary/.test(k)) return '48 Bundles / 2 × 40ft HC Containers';
  if (/goodsdescription|merchandisedescription/.test(k)) return 'Stainless Steel Flat-Rolled Products';
  if (/hsncode|htsus|hsnc|linehtsus/.test(k)) return '7219.11.00';

  // ── Tax IDs / Legal IDs ──────────────────────────────────────────
  if (/gstin|gstno|gstnumber/.test(k)) {
    return /customer|buyer/.test(k) ? '27AABCZ4521G1ZM' : '33AAFCT9874P1ZE';
  }
  if (/pan/.test(k) && k.length < 15) {
    return /customer|buyer/.test(k) ? 'AABCZ4521G' : 'AAFCT9874P';
  }
  if (/cin/.test(k) && !/decimal/.test(k)) return 'U74999MH2017PTC302684';
  if (/\biec\b|iecnumber/.test(k)) return '0417028743';
  if (/adcode/.test(k)) return '0404009';
  if (/ifsc/.test(k)) return 'HDFC0001234';
  if (/swift/.test(k)) return 'HDFCINBBMUM';
  if (/bankaccountno|bankaccount/.test(k)) return '50200099887766';
  if (/bankname/.test(k)) return 'HDFC Bank Ltd';
  if (/bankbranch/.test(k)) return 'Peenya Industrial Area';
  if (/fmc|mtoregistration/.test(k)) return 'FMC-028638';
  if (/cbcode|iecbr/.test(k)) return '0417028743';
  if (/cbname/.test(k)) return ctx.issuer;
  if (/leono/.test(k)) return 'LEO-2526-01234';
  if (/rotn|rotno/.test(k)) return 'ROT-2526/084';
  if (/lutarn/.test(k)) return 'AD210123456789KW';
  if (/gstintype/.test(k)) return 'Regular';

  // ── IRN / QR ─────────────────────────────────────────────────────
  if (/irnacknumber/.test(k)) return '2326022400123456';
  if (/\birn\b/.test(k)) return `c4b8f2e3d9a1${ctx.docNumber.slice(-4)}`;
  if (/qr/.test(k)) return `[QR: ${ctx.docNumber}]`;

  // ── Party names ──────────────────────────────────────────────────
  if (/exportername|shippername|(shipperaddress|exporteraddress)/.test(k)) {
    return /address/.test(k) ? 'Survey No 133, Jigani Hobli, Bangalore 560105'
                              : 'Zetwerk Manufacturing Businesses Pvt Ltd';
  }
  if (/consigneename/.test(k)) return 'Unimatics Inc';
  if (/consigneeaddress/.test(k)) return '1234 Commerce St, Los Angeles, CA 90001';
  if (/consigneephone/.test(k)) return '+1 323 456 7890';
  if (/consigneeemail/.test(k)) return 'freight@unimatics.com';
  if (/notifyparty|notifyname|secondnotify/.test(k)) return 'Unimatics Inc, Los Angeles, CA';
  if (/deliveryagent/.test(k)) {
    return /address/.test(k) ? '2600 E Dominguez St, Carson, CA 90810' : 'Carson City 3PL';
  }
  if (/issuercompany|issuername/.test(k)) return ctx.issuer;
  if (/issueraddress/.test(k)) return '14 GST Rd, Chennai 600032';
  if (/issuerphone/.test(k)) return '+91 44 2812 9900';
  if (/issueremail/.test(k)) return 'billing@transys.in';
  if (/issuerstate/.test(k)) return '33';
  if (/carriername|carriercompany/.test(k)) {
    if (/MSC/.test(ctx.issuer)) return 'MSC Mediterranean Shipping Co.';
    if (/Maersk/.test(ctx.issuer)) return 'Maersk Line';
    return 'COSCO Shipping Lines';
  }
  if (/customername|buyername/.test(k)) return 'Zetwerk Manufacturing Businesses Pvt Ltd';
  if (/customeraddress|buyeraddress/.test(k)) return '1234 Commerce St, Los Angeles, CA 90001';
  if (/customershipment|shipmentnumber/.test(k)) return id;
  if (/customerplace|placeofsupply/.test(k)) return 'Maharashtra';
  if (/warehousename|warehousecode/.test(k)) return 'Carson City 3PL';

  // ── Shipment sub-fields (CHA / FF style) ─────────────────────────
  if (/^shipmentshipper/.test(k)) return 'Zetwerk Manufacturing Businesses Pvt Ltd';
  if (/^shipmentconsignee/.test(k)) return 'Unimatics Inc, Los Angeles, CA';
  if (/^shipmentvessel/.test(k)) return vessel(ctx);
  if (/^shipmentmbl|masterbil|oceanbol/.test(k)) return 'COSU1234567890';
  if (/^shipmenthbl|housebil/.test(k)) return ctx.docNumber;
  if (/^shipmentgrossweight/.test(k)) return '97,873 kg';
  if (/^shipmentorigin/.test(k)) return 'Chennai, India';
  if (/^shipmentdestination/.test(k)) return 'Los Angeles, USA';
  if (/^shipmentetd/.test(k)) return '15-Jan-2026';
  if (/^shipmenteta/.test(k)) return '26-Feb-2026';
  if (/^shipmentincoterm/.test(k)) return 'CFR';
  if (/^shipmentpackages/.test(k)) return '48';
  if (/^shipmentorder/.test(k)) return `ZW-EXP-${id.slice(-8)}`;
  if (/^shipmentgoods/.test(k)) return 'Stainless Steel Flat-Rolled Products';

  // ── BOL-specific ─────────────────────────────────────────────────
  if (/oceanbol|masterbil/.test(k)) return 'COSU1234567890';
  if (/housebil/.test(k)) return ctx.docNumber;
  if (/numberoforiginals/.test(k)) return '3';
  if (/charterpartydate/.test(k)) return '12-Dec-2025';
  if (/negotiability|copytype/.test(k)) return 'Original';
  if (/shipsremarks|usnotes/.test(k)) return 'Freight Prepaid';

  // ── References / PO ──────────────────────────────────────────────
  if (/buyerpono|buyerponumber/.test(k)) return 'PO-UNI-2526-00892';
  if (/buyerpodate|podate/.test(k)) return '05-Jan-2026';
  if (/zetwerkref|otherreferences|orderreference/.test(k)) return `ZW-EXP-${id.slice(-8)}`;
  if (/projectname/.test(k)) return 'Unimatics SS Coil Supply';
  if (/shipmentreference|shipmentid|^shipmentno$/.test(k)) return id;
  if (/bookingnumber/.test(k)) return 'BKG-9924401';
  if (/jobnumber/.test(k)) return `JOB-${id.slice(-6)}-2526`;
  if (/jobdate/.test(k)) return '10-Jan-2026';
  if (/jobpolpod|polpod/.test(k)) return 'Chennai ICD / Los Angeles';
  if (/exportinvoicenumber/.test(k)) return ctx.docNumber;
  if (/exportshippingbillnumber|sbnumbers/.test(k)) return '9685801';
  if (/exportinvoicedate|exportshippingbilldate/.test(k)) return '20-Jan-2026';
  if (/customerinvoicenumbers/.test(k)) return ctx.docNumber;

  // ── Financials ───────────────────────────────────────────────────
  if (/grandtotal|totalamount|invoicevalue|totalusd|totalinr/.test(k)) {
    return isUS(ctx) ? '$84,250.00' : '₹ 5,05,335.00';
  }
  if (/subtotal|taxablevalue|subtotalinr|subtotalusd/.test(k)) {
    return isUS(ctx) ? '$80,714.29' : '₹ 4,28,250.00';
  }
  if (/igst/.test(k)) return '₹ 77,085.00';
  if (/cgst|sgst/.test(k)) return '₹ 0.00';
  if (/taxamount/.test(k)) return '₹ 77,085.00';
  if (/freightamount|freightcharge/.test(k)) return '$3,420.00';
  if (/fobcharges|fobvalue/.test(k)) return '$84,250.00';
  if (/freightpayableat/.test(k)) return 'Prepaid';
  if (/freighttype/.test(k)) return 'Prepaid';
  if (/netpayable/.test(k)) return '₹ 5,05,335.00';
  if (/amountinwords/.test(k)) return 'Rupees Five Lakhs Five Thousand Three Hundred Thirty Five Only';
  if (/amount|value|charges/.test(k)) return isUS(ctx) ? '$1,250.00' : '₹ 1,25,000.00';
  if (/currency/.test(k)) return isUS(ctx) ? 'USD' : 'INR';
  if (/paymentterms/.test(k)) return '30 days net';
  if (/tax/.test(k)) return 'IGST';

  // ── Doc type labels ───────────────────────────────────────────────
  if (/documenttype|documentvariant|documentcategory/.test(k)) return 'Tax Invoice';
  if (/invoicetype/.test(k)) return 'Export Invoice';

  // ── Broker / SB details ──────────────────────────────────────────
  if (k === 'sbno') return ctx.docNumber;
  if (/iecbr/.test(k)) return '0417028743';
  if (/leodate/.test(k)) return '20-Jan-2026';
  if (/invcount/.test(k)) return '1';
  if (/itemcount/.test(k)) return '3';

  // ── GRN / WH ─────────────────────────────────────────────────────
  if (/grnno|grnnumber/.test(k)) return `GRN-CAR-2526-${ctx.docNumber.slice(-5)}`;
  if (/grndate|receiptdate/.test(k)) return '15-Feb-2026';
  if (/customerporef|purchaseorder|ponumber/.test(k)) return 'PO-UNI-2526-00892';
  if (/appointmenttime/.test(k)) return '2026-02-10 09:00';
  if (/totallines|lineno/.test(k)) return '3';

  // ── Signatory ────────────────────────────────────────────────────
  if (/signatory|preparedby|approvedby/.test(k)) return 'Rajesh Kumar';
  if (/designation/.test(k)) return 'Director';
  if (/dinnumber/.test(k)) return '02845931';
  if (/lutarn/.test(k)) return 'AD210123456789KW';
  if (/rotation/.test(k)) return 'ROT-2526/084';
  if (/digitalsignature.*status/.test(k)) return 'Verified';
  if (/digitalsignature.*location/.test(k)) return 'Bangalore';
  if (/signature/.test(k)) return 'Present';

  // ── US-specific ───────────────────────────────────────────────────
  if (/broker/.test(k)) return 'Apex Customs Brokers';
  if (/cbpport|portofentry/.test(k)) return 'Los Angeles (2704)';
  if (/importerein|importeriden/.test(k)) return '98-7654321';
  if (/bondtype/.test(k)) return 'Single Transaction';
  if (/releasedate/.test(k)) return '14-Feb-2026';
  if (/entrysummarydate/.test(k)) return '12-Feb-2026';
  if (/spi|specialprog/.test(k)) return 'N/A';
  if (/htsus/.test(k)) return '7219.11.00';
  if (/adcvd/.test(k)) return '0';

  return '';
}

function genConf(key: string, isBad: boolean, ctx: CardCtx): number {
  if (isBad) return 0.0;
  const base = Math.max(0.88, Math.min(0.99, ctx.avgConfidence));
  const spread = ((h(key) % 12) - 4) * 0.005;
  return Math.round(Math.min(1.0, Math.max(0.72, base + spread)) * 100) / 100;
}

export function buildMockSections(docCode: string, ctx: CardCtx): MockSection[] {
  const configKey = DOC_CODE_TO_CONFIG_KEY[docCode] ?? 'SALES_INVOICE';
  const config = DOC_FIELD_CONFIG[configKey];
  if (!config) return [];

  const allKeys = config.sections.flatMap(s => s.fields.map(f => f.key));
  const badCount = Math.max(1, Math.round(allKeys.length * 0.035));
  const badSet = new Set<string>();
  for (let i = 0; i < badCount; i++) {
    badSet.add(allKeys[h(ctx.docNumber + i) % allKeys.length]);
  }

  return config.sections.map(section => ({
    sectionLabel: section.sectionLabel,
    fields: section.fields.map(field => ({
      key: field.key,
      label: field.label,
      mono: field.mono,
      critical: field.critical,
      value: badSet.has(field.key) ? '' : genValue(field, ctx),
      confidence: genConf(field.key, badSet.has(field.key), ctx),
    })),
  }));
}
