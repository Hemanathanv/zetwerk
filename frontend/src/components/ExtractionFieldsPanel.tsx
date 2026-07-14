import { useEffect, useState } from 'react';
import { getAuthToken } from '@/lib/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';

const API_BASE = ((import.meta.env.VITE_BACKEND_API_BASE as string | undefined) ?? '').replace(/\/$/, '');

interface Props {
  documentId: string;
}

type ScalarField = [string, string | number | boolean | null];

interface SectionDef {
  id: string;
  label: string;
  keys: string[];
  arrayKeys: string[];
}

// All field names are camelCase — matching Prisma model field names returned by the API.
// Each section also declares the array relation keys that belong to it.
const SECTIONS: SectionDef[] = [
  {
    id: 'header',
    label: 'Header',
    keys: [
      // Sales Invoice / Packing List header
      'invoiceNo', 'invoiceNumber', 'invoiceDate', 'issueDate', 'invoiceType',
      'buyerPoNo', 'buyerPoDate', 'zetwerkRef', 'shippingBillNo', 'shippingBillDate',
      'lutArnNo', 'otherReferences', 'dispatchedThrough', 'pickupAddress',
      // CHA Bill / Entry Summary
      'documentNumber', 'documentDate', 'filerCodeEntryNumber', 'entryType',
      'billDate', 'billNumber',
      // US docs
      'entryNo', 'entryDate',
      // BillOfLading
      'blNumber', 'issuerName',
      // Shipping Bill
      'sbNumber', 'sbDate',
    ],
    arrayKeys: ['lineItems', 'invoiceLines', 'exportInvoices', 'shippingBills'],
  },
  {
    id: 'entities',
    label: 'Entities',
    keys: [
      'buyerName', 'buyerAddress', 'consigneeName', 'consigneeAddress',
      'exporterName', 'exporterAddress', 'notifyParty', 'shipTo',
      'iec', 'gstin', 'panNo', 'cinNo',
      // CHA / freight
      'shipperName', 'shipperAddress', 'importerName', 'importerAddress',
      'brokerName', 'brokerAddress', 'cbpPort',
      // Shipping Bill
      'exporterGstin', 'exporterIec',
    ],
    arrayKeys: [],
  },
  {
    id: 'financial',
    label: 'Financial',
    keys: [
      'currency', 'totalAmount', 'taxableValue', 'taxAmount', 'cess',
      'incoterms', 'paymentTerms',
      'bankName', 'bankAccountNo', 'bankBranch', 'swiftCode', 'ifscCode',
      'receivablesAssignmentNotice', 'receivablesAssignmentBeneficiary',
      // Entry Summary
      'totalDutyAndTax', 'totalOtherFees',
      // Ocean Freight
      'totalCharges', 'freightAmount', 'freightCurrency',
    ],
    arrayKeys: ['charges', 'taxSummaryEntries'],
  },
  {
    id: 'shipment',
    label: 'Shipment',
    keys: [
      'portOfLoading', 'portOfDischarge', 'placeOfReceipt', 'finalDestination',
      'countryOfOrigin', 'countryOfFinalDestination',
      'vesselFlightNo', 'grossWeight', 'totalQuantity',
      'preCarriageBy', 'marksAndNumbers', 'packageDescription',
      // BillOfLading
      'vessel', 'voyage', 'portOfOrigin',
      // Packing List
      'totalBundles', 'totalQty', 'totalNetWeightKgs', 'totalGrossWeightKgs',
      // Ocean Freight
      'carrier', 'containerCount', 'sealNumbers',
    ],
    arrayKeys: ['containers'],
  },
  {
    id: 'compliance',
    label: 'Compliance',
    keys: [
      'adCode', 'irnNumber', 'rotationNo', 'signature',
      'signatoryName', 'signatoryDesignation', 'dinNumber',
      'digitalSignatureDate', 'digitalSignatureLocation',
      'digitalSignatureTimestamp', 'digitalSignatureStatus',
      // Entry Summary / US customs
      'entrySummaryNo', 'masterBillNo', 'houseBillNo',
      'bondType', 'bondNumber', 'fmcNumber',
    ],
    arrayKeys: ['tariffLines'],
  },
];

const KNOWN_ARRAY_KEYS = new Set<string>([
  'lineItems', 'invoiceLines', 'exportInvoices', 'shippingBills',
  'charges', 'taxSummaryEntries', 'containers', 'tariffLines',
]);

function toLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

function ScalarGrid({ fields }: { fields: ScalarField[] }) {
  if (!fields.length) return null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '1px',
        background: 'hsl(var(--border))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {fields.map(([key, val]) => (
        <div
          key={key}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '8px 12px',
            background: 'hsl(var(--card))',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {toLabel(key)}
          </span>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'hsl(var(--foreground))', wordBreak: 'break-word' }}>
            {formatValue(val)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ArrayTable({ rows, label }: { rows: Record<string, unknown>[]; label: string }) {
  if (!rows.length) return null;
  const firstNonEmpty = rows.find((r) => r && typeof r === 'object' && Object.keys(r).length > 0);
  const cols = Object.keys(firstNonEmpty ?? {}).filter((k) => !['id', 'extractionId', 'createdAt', 'updatedAt'].includes(k));
  if (!cols.length) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--muted-foreground))', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </p>
      <div style={{ overflowX: 'auto', border: '1px solid hsl(var(--border))', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14.5 }}>
          <thead>
            <tr style={{ background: 'hsl(var(--muted))' }}>
              {cols.map((c) => (
                <th key={c} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap', borderBottom: '1px solid hsl(var(--border))' }}>
                  {toLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: i < rows.length - 1 ? '1px solid hsl(var(--border))' : 'none' }}>
                {cols.map((c) => (
                  <td key={c} style={{ padding: '6px 10px', color: 'hsl(var(--foreground))', whiteSpace: 'nowrap' }}>
                    {formatValue(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ARRAY_LABELS: Record<string, string> = {
  lineItems: 'Line Items',
  invoiceLines: 'Invoice Lines',
  exportInvoices: 'Export Invoices',
  shippingBills: 'Shipping Bills',
  containers: 'Containers',
  charges: 'Charges',
  taxSummaryEntries: 'Tax Summary',
  tariffLines: 'Tariff Lines',
};

export function ExtractionFieldsPanel({ documentId }: Props) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE}/api/documents/${documentId}/extraction`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const payload = await res.json().catch(() => null);
        if (!active) return;
        if (!res.ok || !payload?.ok) {
          setError(payload?.error ?? 'Failed to load extraction data');
          return;
        }
        setData(payload.data ?? null);
      } catch (e) {
        if (active) setError('Network error');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [documentId]);

  if (loading) {
    return (
      <div style={{ minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'hsl(var(--muted-foreground))', fontSize: 14 }}>
        <Loader2 size={16} className="animate-spin" />
        Loading extracted fields...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '16px', borderRadius: 8, background: 'hsla(0,84%,60%,0.06)', border: '1px solid hsla(0,84%,60%,0.2)', fontSize: 14.5, color: 'hsl(0 72% 38%)' }}>
        {error ?? 'No extraction data found.'}
      </div>
    );
  }

  // payload.data = { documentId, documentType, ocrStatus, extraction: {...} }
  const extractionObj = (data as any).extraction;
  if (!extractionObj || typeof extractionObj !== 'object' || Array.isArray(extractionObj)) {
    return (
      <div style={{ padding: 16, color: 'hsl(var(--muted-foreground))', fontSize: 14.5 }}>
        No extraction data available for this document type.
      </div>
    );
  }

  const rawFields: Record<string, unknown> = extractionObj;

  type SectionResult = {
    def: SectionDef;
    scalars: ScalarField[];
    arrays: Array<{ key: string; rows: Record<string, unknown>[] }>;
  };

  const usedKeys = new Set<string>();
  const sectionData: SectionResult[] = [];

  for (const def of SECTIONS) {
    const scalars: ScalarField[] = [];
    const arrays: Array<{ key: string; rows: Record<string, unknown>[] }> = [];

    // Collect scalars
    for (const key of def.keys) {
      if (usedKeys.has(key)) continue;
      const val = rawFields[key];
      if (val === undefined || val === null || val === '') continue;
      if (!Array.isArray(val) && typeof val !== 'object') {
        scalars.push([key, val as ScalarField[1]]);
        usedKeys.add(key);
      }
    }

    // Collect explicitly-mapped arrays
    for (const arrayKey of def.arrayKeys) {
      if (usedKeys.has(arrayKey)) continue;
      const val = rawFields[arrayKey];
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && val[0] !== null) {
        arrays.push({ key: arrayKey, rows: val as Record<string, unknown>[] });
        usedKeys.add(arrayKey);
      }
    }

    if (scalars.length > 0 || arrays.length > 0) {
      sectionData.push({ def, scalars, arrays });
    }
  }

  // Catch-all: remaining unused fields
  const catchAllScalars: ScalarField[] = [];
  const catchAllArrays: Array<{ key: string; rows: Record<string, unknown>[] }> = [];
  for (const [key, val] of Object.entries(rawFields)) {
    if (usedKeys.has(key)) continue;
    // Skip internal/meta fields
    if (['id', 'documentId', 'rawData', 'extractedAt', 'reviewedBy', 'reviewedAt', 'createdAt', 'updatedAt'].includes(key)) continue;
    if (Array.isArray(val)) {
      if (val.length > 0 && typeof val[0] === 'object' && val[0] !== null) {
        catchAllArrays.push({ key, rows: val as Record<string, unknown>[] });
      }
    } else if (val !== null && val !== undefined && val !== '') {
      if (typeof val !== 'object') {
        catchAllScalars.push([key, val as ScalarField[1]]);
      }
    }
  }

  if (catchAllScalars.length > 0 || catchAllArrays.length > 0) {
    sectionData.push({
      def: { id: 'other', label: 'Other', keys: [], arrayKeys: [] },
      scalars: catchAllScalars,
      arrays: catchAllArrays,
    });
  }

  if (!sectionData.length) {
    return (
      <div style={{ padding: 16, color: 'hsl(var(--muted-foreground))', fontSize: 14.5 }}>
        No extracted fields available.
      </div>
    );
  }

  const defaultTab = sectionData[0]?.def.id ?? 'header';

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList className="mb-3 flex-wrap h-auto gap-1">
        {sectionData.map(({ def }) => (
          <TabsTrigger key={def.id} value={def.id}>
            {def.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {sectionData.map(({ def, scalars, arrays }) => (
        <TabsContent key={def.id} value={def.id}>
          <ScalarGrid fields={scalars} />
          {arrays.map(({ key, rows }) => (
            <ArrayTable key={key} rows={rows} label={ARRAY_LABELS[key] ?? toLabel(key)} />
          ))}
        </TabsContent>
      ))}
    </Tabs>
  );
}
