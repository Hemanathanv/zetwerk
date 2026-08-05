import { X, Printer, FileText } from 'lucide-react';
import { DocGenSchema } from '@/config/docGenConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PreviewProps {
  schema:         DocGenSchema;
  manualValues:   Record<string, string>;
  computedFields: Record<string, string>;
  computedRowMap: Record<string, Record<string, string>[]>;
  isApproved:     boolean;
  onClose:        () => void;
}

interface GeneratedDocumentPaperProps {
  schema:         DocGenSchema;
  manualValues:   Record<string, string>;
  computedFields?: Record<string, string>;
  computedRowMap?: Record<string, Record<string, string>[]>;
  isApproved?:     boolean;
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const DOC_FG     = '#1a1a2e';
const DOC_MUTED  = '#6b7280';
const DOC_BORDER = '#d1d5db';
const DOC_BG     = '#f9fafb';
const DOC_TEAL   = '#0f766e';
const MONO_FONT  = 'var(--app-font-sans)';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResolver(
  schema: DocGenSchema,
  manualValues: Record<string, string>,
  computedFields: Record<string, string>,
) {
  const mock = schema.mockData.fields as Record<string, string>;
  return function resolve(key: string): string {
    return (
      manualValues[key]?.trim()   ||
      computedFields[key]?.trim() ||
      mock[key]?.toString()?.trim() ||
      '—'
    );
  };
}

function makeRowResolver(
  schema: DocGenSchema,
  manualValues: Record<string, string>,
  computedRowMap: Record<string, Record<string, string>[]>,
) {
  const mockTables = schema.mockData.tables as Record<string, Record<string, string>[]>;
  return function resolveRow(section: string, rowIdx: number, field: string): string {
    return (
      manualValues[`${section}.${rowIdx}.${field}`]?.trim()  ||
      computedRowMap[section]?.[rowIdx]?.[field]?.trim()     ||
      mockTables[section]?.[rowIdx]?.[field]?.toString()?.trim() ||
      '—'
    );
  };
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function DocHeader({ title, docNumber, date, subtitle }: {
  title: string; docNumber?: string; date?: string; subtitle?: string;
}) {
  return (
    <div style={{ marginBottom: 20, paddingBottom: 14, borderBottom: `2px solid ${DOC_TEAL}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{
            fontSize: 14.5, fontWeight: 700, letterSpacing: '0.12em', color: DOC_TEAL,
            textTransform: 'uppercase', marginBottom: 2,
          }}>
            Export Workflow Management System
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: DOC_FG, margin: 0, letterSpacing: 0 }}>
            {title}
          </h1>
          {subtitle && (
            <div style={{ fontSize: 14, color: DOC_MUTED, marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          {docNumber && (
            <div style={{ fontSize: 14, fontWeight: 700, color: DOC_FG, fontFamily: MONO_FONT }}>{docNumber}</div>
          )}
          {date && (
            <div style={{ fontSize: 14.5, color: DOC_MUTED, marginTop: 2 }}>Date: {date}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoGrid({ rows }: { rows: [string, string | undefined][][] }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: 'grid', gridTemplateColumns: `repeat(${row.length}, 1fr)`, gap: '0 12px', marginBottom: 0 }}>
          {row.map(([label, value], ci) => (
            <div key={ci} style={{ borderBottom: `1px solid ${DOC_BORDER}`, paddingBottom: 6, paddingTop: 6 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: DOC_MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ fontSize: 14.5, color: value === '—' ? DOC_MUTED : DOC_FG, fontStyle: value === '—' ? 'italic' : 'normal' }}>
                {value || '—'}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 14.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
      color: DOC_TEAL, borderBottom: `1px solid ${DOC_TEAL}`, paddingBottom: 3,
      marginBottom: 10, marginTop: 18,
    }}>
      {children}
    </div>
  );
}

function DocTable({ cols, rows, totalsRow }: {
  cols: { label: string; key: string; align?: 'left' | 'right' | 'center'; mono?: boolean; width?: string }[];
  rows: string[][];
  totalsRow?: string[];
}) {
  const thStyle: React.CSSProperties = {
    fontSize: 14.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
    color: DOC_MUTED, padding: '6px 8px', borderBottom: `2px solid ${DOC_BORDER}`,
    background: DOC_BG, textAlign: 'left', overflowWrap: 'anywhere', wordBreak: 'break-word',
  };
  const tdBase: React.CSSProperties = {
    fontSize: 14.5, padding: '5px 8px', borderBottom: `1px solid ${DOC_BORDER}`, color: DOC_FG, verticalAlign: 'top',
    overflowWrap: 'anywhere', wordBreak: 'break-word',
  };
  return (
    <table style={{ width: '100%', maxWidth: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 14.5, marginBottom: 8 }}>
      <thead>
        <tr>
          {cols.map(c => (
            <th key={c.key} style={{ ...thStyle, textAlign: c.align ?? 'left', width: c.width }}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : DOC_BG }}>
            {row.map((cell, ci) => (
              <td key={ci} style={{
                ...tdBase,
                textAlign: cols[ci]?.align ?? 'left',
                fontFamily: cols[ci]?.mono ? MONO_FONT : 'inherit',
                color: cell === '—' ? DOC_MUTED : DOC_FG,
                fontStyle: cell === '—' ? 'italic' : 'normal',
              }}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
        {totalsRow && (
          <tr style={{ background: '#e5f3f2' }}>
            {totalsRow.map((cell, ci) => (
              <td key={ci} style={{
                ...tdBase,
                fontWeight: 700,
                textAlign: cols[ci]?.align ?? 'left',
                fontFamily: cols[ci]?.mono ? MONO_FONT : 'inherit',
                borderTop: `1.5px solid ${DOC_TEAL}`,
                color: DOC_FG,
              }}>
                {cell}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}

function SignatoryBlock({ label, name, designation, dinRef, date }: {
  label?: string; name?: string; designation?: string; dinRef?: string; date?: string;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'flex-end', marginTop: 28,
    }}>
      <div style={{
        border: `1px solid ${DOC_BORDER}`, borderRadius: 8, padding: '14px 24px',
        minWidth: 200, textAlign: 'center',
      }}>
        <div style={{ height: 36, borderBottom: `1px solid ${DOC_BORDER}`, marginBottom: 8 }} />
        <div style={{ fontSize: 14.5, fontWeight: 700, color: DOC_FG }}>{name || '________________________'}</div>
        {designation && <div style={{ fontSize: 14, color: DOC_MUTED }}>{designation}</div>}
        {dinRef && <div style={{ fontSize: 14, color: DOC_MUTED, fontFamily: MONO_FONT }}>DIN: {dinRef}</div>}
        {date && <div style={{ fontSize: 14, color: DOC_MUTED, marginTop: 4 }}>Date: {date}</div>}
        <div style={{ fontSize: 14.5, color: DOC_MUTED, marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label ?? 'Authorised Signatory'}
        </div>
      </div>
    </div>
  );
}

// ─── Packing List template ────────────────────────────────────────────────────

function PackingListDoc({ schema, resolve, resolveRow }: {
  schema: DocGenSchema;
  resolve: (k: string) => string;
  resolveRow: (s: string, r: number, f: string) => string;
}) {
  const mockRows = (schema.mockData.tables as Record<string, unknown[]>)['Line Items'] ?? [];
  const lineItemCols = [
    { key: 'hsnCode',        label: 'HSN Code',    mono: true, width: '10%' },
    { key: 'productCode',    label: 'Product Code', mono: true, width: '12%' },
    { key: 'productDesc',    label: 'Description',  width: '26%' },
    { key: 'totalQtyInPcs', label: 'Qty (PCS)',    align: 'right' as const, mono: true, width: '8%' },
    { key: 'kindOfPkg',      label: 'Pkg Type',     width: '8%' },
    { key: 'noOfBundles',    label: 'Bundles',      align: 'right' as const, mono: true, width: '8%' },
    { key: 'qtyPerBundle',   label: 'Qty/Bundle',   align: 'right' as const, mono: true, width: '9%' },
    { key: 'netWeightKgs',   label: 'Net Wt (kg)',  align: 'right' as const, mono: true, width: '9%' },
    { key: 'grossWeightKgs', label: 'Gross Wt (kg)', align: 'right' as const, mono: true, width: '10%' },
  ];
  const lineRows = mockRows.map((_, ri) =>
    lineItemCols.map(c => resolveRow('Line Items', ri, c.key))
  );
  const totals = [
    'TOTALS', '', '', resolve('totalQty'), '', resolve('totalBundles'), '',
    resolve('totalNetWeightKgs'), resolve('totalGrossWeightKgs'),
  ];

  return (
    <div>
      <DocHeader
        title="Packing List"
        docNumber={resolve('invoiceNo')}
        date={resolve('invoiceDate')}
        subtitle={`Buyer PO: ${resolve('buyerPoNo')} · Exporter Ref: ${resolve('exporterRef')}`}
      />

      <SectionTitle>Parties</SectionTitle>
      <InfoGrid rows={[
        [['Exporter', resolve('exporterName')], ['Buyer / Importer', resolve('buyerName')]],
        [['Exporter Address', resolve('exporterAddress')], ['Buyer Address', resolve('buyerAddress')]],
        [['Consignee', resolve('consigneeName')], ['Ship To', resolve('shipTo')]],
        [['GSTIN', resolve('gstin')], ['IEC Number', resolve('iec')]],
      ]} />

      <SectionTitle>Shipping Details</SectionTitle>
      <InfoGrid rows={[
        [['Port of Loading', resolve('portOfLoading')], ['Port of Discharge', resolve('portOfDischarge')], ['Country of Origin', resolve('countryOfOrigin')]],
        [['Final Destination', resolve('finalDestination')], ['Vessel / Flight', resolve('vesselFlightNo')], ['Pre-Carriage', resolve('preCarriageBy')]],
        [['Place of Receipt', resolve('placeOfReceipt')], ['Country of Final Destination', resolve('countryOfFinalDestination')]],
      ]} />

      <SectionTitle>Line Items</SectionTitle>
      <DocTable cols={lineItemCols} rows={lineRows} totalsRow={totals} />

      <SectionTitle>Summary Totals</SectionTitle>
      <InfoGrid rows={[
        [
          ['Total Qty (PCS)', resolve('totalQty')],
          ['Total Bundles', resolve('totalBundles')],
          ['Total Net Weight (kg)', resolve('totalNetWeightKgs')],
          ['Total Gross Weight (kg)', resolve('totalGrossWeightKgs')],
        ],
      ]} />

      <SignatoryBlock
        name={resolve('signatoryName')}
        designation={resolve('signatoryDesignation')}
        dinRef={resolve('dinNumber')}
        date={resolve('invoiceDate')}
      />
    </div>
  );
}

// ─── Outward GRN template ─────────────────────────────────────────────────────

function OutwardGRNDoc({ schema, resolve, resolveRow }: {
  schema: DocGenSchema;
  resolve: (k: string) => string;
  resolveRow: (s: string, r: number, f: string) => string;
}) {
  const mockContainers = (schema.mockData.tables as Record<string, unknown[]>)['Container Allocation'] ?? [];
  const mockLineItems  = (schema.mockData.tables as Record<string, unknown[]>)['Line Items'] ?? [];

  const containerCols = [
    { key: 'containerNo',   label: 'Container No',   mono: true, width: '22%' },
    { key: 'sealNumber',    label: 'Seal No',         mono: true, width: '20%' },
    { key: 'containerType', label: 'Type',            width: '14%' },
    { key: 'assignedItems', label: 'Items Assigned',  width: '30%' },
    { key: 'containerWt',   label: 'Gross Wt (kg)',   align: 'right' as const, mono: true, width: '14%' },
  ];
  const containerRows = mockContainers.map((_, ri) =>
    containerCols.map(c => resolveRow('Container Allocation', ri, c.key))
  );

  const lineItemCols = [
    { key: 'hsnCode',        label: 'HSN Code',       mono: true, width: '10%' },
    { key: 'productCode',    label: 'Product Code',   mono: true, width: '14%' },
    { key: 'productDesc',    label: 'Description',    width: '28%' },
    { key: 'totalQtyInPcs', label: 'Qty (PCS)',      align: 'right' as const, mono: true, width: '10%' },
    { key: 'noOfBundles',    label: 'Bundles',        align: 'right' as const, mono: true, width: '8%' },
    { key: 'netWeightKgs',   label: 'Net Wt (kg)',    align: 'right' as const, mono: true, width: '10%' },
    { key: 'grossWeightKgs', label: 'Gross Wt (kg)',  align: 'right' as const, mono: true, width: '10%' },
    { key: 'grossWeightLbs', label: 'Gross Wt (lbs)', align: 'right' as const, mono: true, width: '10%' },
  ];
  const lineRows = mockLineItems.map((_, ri) =>
    lineItemCols.map(c => resolveRow('Line Items', ri, c.key))
  );
  const lineTotals = ['TOTALS', '', '', resolve('totalQty'), resolve('totalBundles'), '—', resolve('totalGrossWeightLbs').replace('lbs','').trim(), resolve('totalGrossWeightLbs')];

  return (
    <div>
      <DocHeader
        title="Outward GRN"
        docNumber={`BOL: ${resolve('bolRef')}`}
        date={resolve('grnDate') !== '—' ? resolve('grnDate') : 'Pending'}
        subtitle={`PL Ref: ${resolve('plRef')} · PO: ${resolve('buyerPoNo')} · Exporter Ref: ${resolve('exporterRef')}`}
      />

      <SectionTitle>Parties</SectionTitle>
      <InfoGrid rows={[
        [['Shipper', resolve('shipperName')], ['Consignee', resolve('consigneeName')]],
        [['Shipper Address', resolve('shipperAddress')], ['Consignee Address', resolve('consigneeAddress')]],
        [['Notify Party', resolve('notifyParty')], ['3PL / Warehouse', resolve('threePlName')]],
        [['3PL Address', resolve('threePlAddress')]],
      ]} />

      <SectionTitle>Shipping</SectionTitle>
      <InfoGrid rows={[
        [['Vessel', resolve('vesselName')], ['Voyage', resolve('voyageNumber')], ['Incoterms', resolve('incoterms')]],
        [['Port of Loading', resolve('portOfLoading')], ['Port of Discharge', resolve('portOfDischarge')], ['ETA', resolve('eta')]],
        [['Country of Origin', resolve('countryOfOrigin')]],
      ]} />

      <SectionTitle>Container Allocation</SectionTitle>
      <DocTable cols={containerCols} rows={containerRows} />

      <SectionTitle>Line Items</SectionTitle>
      <DocTable cols={lineItemCols} rows={lineRows} totalsRow={lineTotals} />

      <SectionTitle>Summary Totals</SectionTitle>
      <InfoGrid rows={[
        [
          ['Total Qty (PCS)', resolve('totalQty')],
          ['Total Bundles', resolve('totalBundles')],
          ['Total Net Wt (lbs)', resolve('totalNetWeightLbs')],
          ['Total Gross Wt (lbs)', resolve('totalGrossWeightLbs')],
        ],
      ]} />

      <SectionTitle>Receipt Confirmation</SectionTitle>
      <InfoGrid rows={[
        [
          ['Received By', resolve('receivedBy')],
          ['Receipt Date', resolve('receivedDate')],
          ['Warehouse Code', resolve('warehouseCode')],
          ['PO Reference', resolve('poReference')],
        ],
      ]} />
    </div>
  );
}

// ─── Draft Bill of Entry template ─────────────────────────────────────────────

function DraftBoEDoc({ schema, resolve, resolveRow }: {
  schema: DocGenSchema;
  resolve: (k: string) => string;
  resolveRow: (s: string, r: number, f: string) => string;
}) {
  const mockTariffLines = (schema.mockData.tables as Record<string, unknown[]>)['Tariff Lines'] ?? [];

  const tariffCols = [
    { key: 'lineNo',         label: 'Line',             mono: true, width: '6%' },
    { key: 'lineHtsusNumber', label: 'HTSUS Code',     mono: true, width: '15%' },
    { key: 'lineMerchandiseDescription', label: 'Description', width: '28%' },
    { key: 'quantity',       label: 'Qty',              align: 'right' as const, mono: true, width: '8%' },
    { key: 'quantityUnit',   label: 'Unit',             width: '6%' },
    { key: 'enteredValue',   label: 'Entered Value',    align: 'right' as const, mono: true, width: '13%' },
    { key: 'dutyRate',       label: 'Duty Rate',        align: 'right' as const, mono: true, width: '10%' },
    { key: 'dutyAmount',     label: 'Duty Amount',      align: 'right' as const, mono: true, width: '10%' },
  ];
  const tariffRows = mockTariffLines.map((_, ri) =>
    tariffCols.map(c => resolveRow('Tariff Lines', ri, c.key))
  );

  const fieldSections = schema.sections.filter(section => section.renderAs === 'fields');
  return (
    <div>
      <DocHeader
        title="Draft CBP FORM 7501"
        docNumber={`BOL: ${resolve('blOrAwbNumber')}`}
        date={resolve('summaryDate') !== 'â€”' ? resolve('summaryDate') : 'Pending'}
        subtitle="Draft CBP FORM 7501 working document"
      />
      {fieldSections.map(section => {
        const rows: [string, string | undefined][][] = [];
        for (let index = 0; index < section.mappings.length; index += 3) {
          rows.push(section.mappings.slice(index, index + 3).map(mapping => [
            mapping.targetLabel,
            resolve(mapping.targetField),
          ]));
        }
        return (
          <div key={section.sectionLabel}>
            <SectionTitle>{section.sectionLabel}</SectionTitle>
            <InfoGrid rows={rows} />
          </div>
        );
      })}
      <SectionTitle>Tariff Lines</SectionTitle>
      <DocTable cols={tariffCols} rows={tariffRows} />
    </div>
  );

  return (
    <div>
      <DocHeader
        title="Draft CBP FORM 7501"
        docNumber={`Master BOL: ${resolve('masterBol')}`}
        date={resolve('entryDate') !== '—' ? resolve('entryDate') : 'Pending'}
        subtitle="Draft CBP FORM 7501 (Not for Official Use)"
      />

      <SectionTitle>Entry Details</SectionTitle>
      <InfoGrid rows={[
        [['Entry Type', resolve('entryType')], ['Port of Entry', resolve('portOfEntry')], ['Entry Date', resolve('entryDate')]],
        [['Bond Type', resolve('bondType')], ['Importer EIN', resolve('importerEIN')]],
      ]} />

      <SectionTitle>Transport</SectionTitle>
      <InfoGrid rows={[
        [['Vessel', resolve('vesselName')], ['Voyage', resolve('voyageNumber')], ['Port of Lading', resolve('portOfLoading')]],
        [['Arrival Date', resolve('arrivalDate')], ['Master BOL', resolve('masterBol')], ['House BOL', resolve('houseBol')]],
      ]} />

      <SectionTitle>Importer of Record</SectionTitle>
      <InfoGrid rows={[
        [['Importer Name', resolve('importerName')], ['Customs Broker', resolve('brokerFirm')]],
        [['Importer Address', resolve('importerAddress')], ['Contact', resolve('importerContact')]],
      ]} />

      <SectionTitle>Origin &amp; Manufacturer</SectionTitle>
      <InfoGrid rows={[
        [['Country of Origin', resolve('countryOfOrigin')], ['Manufacturer Name', resolve('manufacturerName')], ['Manufacturer ID (MID)', resolve('manufacturerID')]],
        [['Exporter GSTIN', resolve('exporterGSTIN')]],
      ]} />

      <SectionTitle>Steel Melt &amp; Pour Declaration</SectionTitle>
      <InfoGrid rows={[
        [['Country of Melt', resolve('meltCountry')], ['Country of Pour', resolve('pourCountry')], ['Cert. Date', resolve('certificationDate')]],
        [['Cert. Reference', resolve('certificationRef')]],
      ]} />

      <SectionTitle>Cargo</SectionTitle>
      <InfoGrid rows={[
        [['Goods Description', resolve('goodsDescription')]],
        [
          ['Gross Weight', resolve('grossWeight')],
          ['Net Weight', resolve('netWeight')],
          ['Total Packages', resolve('totalPackages')],
          ['Containers', resolve('containerCount')],
          ['Volume (CBM)', resolve('measurementCbm')],
        ],
      ]} />

      <SectionTitle>Tariff Lines</SectionTitle>
      <DocTable cols={tariffCols} rows={tariffRows} />

      <SectionTitle>Duties &amp; Fees</SectionTitle>
      <div style={{
        background: DOC_BG, border: `1px solid ${DOC_BORDER}`, borderRadius: 8,
        padding: '12px 16px', marginBottom: 8,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {[
            ['Total Duty Amount', resolve('totalDutyAmount')],
            ['Section 232 Rate', resolve('section232Rate')],
            ['Section 232 Amount', resolve('section232Amount')],
            ['MPF', resolve('mpfAmount')],
          ].map(([label, value]) => (
            <div key={label} style={{ borderBottom: `1px solid ${DOC_BORDER}`, paddingBottom: 6 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: DOC_MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 14.5, color: DOC_FG, fontFamily: MONO_FONT }}>{value}</div>
            </div>
          ))}
          <div style={{ borderBottom: `1.5px solid ${DOC_TEAL}`, paddingBottom: 6, gridColumn: '3' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: DOC_TEAL, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Total Amount Due</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: DOC_FG, fontFamily: MONO_FONT }}>{resolve('totalAmountDue')}</div>
          </div>
        </div>
      </div>

      <SectionTitle>Broker Certification</SectionTitle>
      <InfoGrid rows={[
        [['Broker Firm', resolve('brokerFirmName')], ['License No', resolve('brokerLicenseNo')]],
        [['Signatory', resolve('brokerSignatory')], ['Signature Date', resolve('signatureDate')]],
      ]} />
    </div>
  );
}

// ─── Watermark ────────────────────────────────────────────────────────────────

function Watermark({ label }: { label: string }) {
  return (
    <div style={{
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%) rotate(-35deg)',
      fontSize: 72, fontWeight: 900, letterSpacing: '0.08em',
      color: label === 'APPROVED' ? 'hsla(152,69%,31%,0.08)' : 'hsla(0,84%,60%,0.07)',
      pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap',
      zIndex: 0,
    }}>
      {label}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function DocumentPreviewModal({
  schema, manualValues, computedFields, computedRowMap, isApproved, onClose,
}: PreviewProps) {
  const resolve    = makeResolver(schema, manualValues, computedFields);
  const resolveRow = makeRowResolver(schema, manualValues, computedRowMap);

  function handlePrint() {
    window.print();
  }

  function renderDoc() {
    switch (schema.docType) {
      case 'packing-list':
        return <PackingListDoc schema={schema} resolve={resolve} resolveRow={resolveRow} />;
      case 'outward-pl':
        return <OutwardGRNDoc schema={schema} resolve={resolve} resolveRow={resolveRow} />;
      case 'draft-boe':
        return <DraftBoEDoc schema={schema} resolve={resolve} resolveRow={resolveRow} />;
      default:
        return (
          <div style={{ textAlign: 'center', padding: 40, color: DOC_MUTED }}>
            <FileText size={32} style={{ marginBottom: 12 }} />
            <div>No preview template for "{schema.displayName}"</div>
          </div>
        );
    }
  }

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body * { visibility: hidden !important; }
          #doc-preview-root, #doc-preview-root * { visibility: visible !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          #doc-preview-root {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            height: auto !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          .doc-preview-overlay { background: transparent !important; }
          .doc-preview-modal {
            display: block !important;
            background: #fff !important;
            box-shadow: none !important;
            max-width: none !important;
            max-height: none !important;
            width: 100% !important;
            border-radius: 0 !important;
          }
          .doc-preview-toolbar { display: none !important; }
          .doc-preview-modal > div:last-child {
            overflow: visible !important;
            padding: 0 !important;
          }
          .doc-preview-paper {
            box-shadow: none !important;
            margin: 0 !important;
            min-height: 0 !important;
            overflow: visible !important;
            padding: 8mm !important;
          }
        }
      `}</style>

      {/* Overlay */}
      <div
        id="doc-preview-root"
        className="doc-preview-overlay"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          zIndex: 9000, padding: '24px 16px', overflowY: 'auto',
        }}
      >
        <div
          className="doc-preview-modal"
          style={{
            background: '#f0f0f0', borderRadius: 8, width: '100%', maxWidth: 900,
            boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
            display: 'flex', flexDirection: 'column', minHeight: 0,
          }}
        >
          {/* Toolbar */}
          <div
            className="doc-preview-toolbar"
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 16px', borderBottom: '1px solid #d1d5db',
              background: '#fff', borderRadius: '12px 12px 0 0', flexShrink: 0,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{schema.displayName}</div>
              <div style={{ fontSize: 14.5, color: '#6b7280', marginTop: 1 }}>
                {isApproved
                  ? '✓ Approved — final document'
                  : 'Draft preview — pending approval'
                }
              </div>
            </div>

            {/* Status pill */}
            <div style={{
              padding: '3px 10px', borderRadius: 999, fontSize: 14.5, fontWeight: 700,
              background: isApproved ? 'hsla(152,69%,31%,0.12)' : 'hsla(38,92%,50%,0.12)',
              color: isApproved ? '#0f766e' : '#92400e',
              border: `1px solid ${isApproved ? 'hsla(152,69%,31%,0.25)' : 'hsla(38,92%,50%,0.3)'}`,
            }}>
              {isApproved ? '✓ APPROVED' : 'DRAFT'}
            </div>

            <button
              onClick={handlePrint}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 6, fontSize: 14, fontWeight: 600,
                background: '#f3f4f6', border: '1px solid #d1d5db', cursor: 'pointer', color: '#374151',
              }}
            >
              <Printer size={13} />
              Print / Save PDF
            </button>

            <button
              onClick={onClose}
              style={{
                width: 30, height: 30, borderRadius: 6, border: '1px solid #d1d5db',
                background: 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X size={15} style={{ color: '#6b7280' }} />
            </button>
          </div>

          {/* Paper */}
          <div style={{ overflowY: 'auto', padding: '24px', flex: 1 }}>
            <div
              className="doc-preview-paper"
              style={{
                background: '#fff', borderRadius: 4,
                boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
                padding: '40px 48px 48px',
                position: 'relative', overflow: 'hidden',
                minHeight: 900, margin: '0 auto',
              }}
            >
              <Watermark label={isApproved ? 'APPROVED' : 'DRAFT'} />
              <div style={{ position: 'relative', zIndex: 1 }}>
                {renderDoc()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function GeneratedDocumentPaper({
  schema,
  manualValues,
  computedFields = {},
  computedRowMap = {},
  isApproved = false,
}: GeneratedDocumentPaperProps) {
  const resolve    = makeResolver(schema, manualValues, computedFields);
  const resolveRow = makeRowResolver(schema, manualValues, computedRowMap);

  function renderDoc() {
    switch (schema.docType) {
      case 'packing-list':
        return <PackingListDoc schema={schema} resolve={resolve} resolveRow={resolveRow} />;
      case 'outward-pl':
        return <OutwardGRNDoc schema={schema} resolve={resolve} resolveRow={resolveRow} />;
      case 'draft-boe':
        return <DraftBoEDoc schema={schema} resolve={resolve} resolveRow={resolveRow} />;
      default:
        return (
          <div style={{ textAlign: 'center', padding: 40, color: DOC_MUTED }}>
            <FileText size={32} style={{ marginBottom: 12 }} />
            <div>No preview template for "{schema.displayName}"</div>
          </div>
        );
    }
  }

  return (
    <div
      className="doc-preview-paper"
      style={{
        background: '#fff',
        borderRadius: 4,
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        padding: '40px 48px 48px',
        position: 'relative',
        overflow: 'hidden',
        minHeight: 900,
        margin: '0 auto',
      }}
    >
      <Watermark label={isApproved ? 'APPROVED' : 'DRAFT'} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {renderDoc()}
      </div>
    </div>
  );
}
