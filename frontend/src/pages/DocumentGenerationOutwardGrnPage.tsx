import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronDown, ChevronUp, FileText, Loader2, Package, Plus, Send, Truck, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { getAuthToken, apiUrl, readJsonResponse } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { usePermissions } from '@/contexts/PermissionContext';
import { allowedDocGenerationOptions } from '@/lib/docGenerationAccess';
import { DocumentPreviewModal } from '@/components/DocumentPreviewModal';
import { DOC_GEN_SCHEMAS, DocGenSchema, FieldMapping, GenSection, MappingType } from '@/config/docGenConfig';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtAvailable(value: number) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type StockRow = {
  id: string;
  productCode: string;
  description: string | null;
  hsCode: string | null;
  quantityOnHand: number;
  physicalQuantityOnHand?: number;
  reservedQuantity: number;
  availableQuantity: number;
  netWeightKg: number;
  warehouse?: { id: string; name: string };
};

type DispatchLine = {
  warehouseStockId: string;
  stockAllocations: Array<{
    warehouseStockId: string;
    availableQty: number;
  }>;
  productCode: string;
  description: string;
  availableQty: number;
  netWeightPerUnit: number;
  quantityDispatched: string;
  netWeightKg: string;
  packageType: string;
};

type OutwardRecord = {
  id: string;
  status: 'DRAFT' | 'CONFIRMED' | 'DISPATCHED';
  destinationName?: string | null;
  destinationAddress?: string | null;
  truckNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
  warehouse?: WarehouseOption | null;
  createdAt?: string | null;
  dispatchedAt?: string | null;
  documentId?: string | null;
  draftPayload?: DraftPayload;
  lines?: Array<{
    id: string;
    quantityDispatched: number;
    netWeightKg: number;
    warehouseStock?: {
      id?: string | null;
      productCode?: string | null;
      description?: string | null;
    };
  }>;
};

type DraftFieldValue = {
  targetField: string;
  targetLabel: string;
  value: unknown;
  sourceDoc: string;
  sourceField?: string | null;
  sourceLabel?: string | null;
  mappingType: MappingType;
  validation?: string | null;
  validationSeverity?: 'critical' | 'warning' | 'info' | null;
  mono?: boolean;
};

type DraftPayload = {
  draftId: string;
  generatedDocType: 'US_PACKING_LIST';
  displayName: string;
  status: string;
  sourceDocs: string[];
  sourceDocumentIds: Record<string, string>;
  sections: Array<{ sectionLabel: string; fields: DraftFieldValue[] }>;
  lineItems: Array<Record<string, unknown>>;
  outwardDispatch?: {
    warehouse?: WarehouseOption | null;
    warehouseId?: string | null;
    destinationName?: string | null;
    destinationAddress?: string | null;
  };
  stats?: Record<string, number>;
};

type ApiEnvelope<T> = {
  ok: boolean;
  data: T;
  error?: string;
  detail?: string;
};

type WarehouseOption = {
  id: string;
  name: string;
  address: string | null;
  firmsCode: string | null;
};

type CreateOutwardDispatchPayload = {
  warehouseId: string;
  destinationName: string;
  destinationAddress?: string;
  deliveryDate?: string;
  truckNumber?: string;
  driverName?: string;
  notes?: string;
  lines: Array<{
    warehouseStockId: string;
    quantityDispatched: number;
    netWeightKg?: number;
    packageType?: string;
  }>;
};

const outwardGrnQueryKeys = {
  stock: ['document-generation', 'outward-grn', 'warehouse-stock'] as const,
  warehouses: ['document-generation', 'outward-grn', 'warehouses'] as const,
  dispatches: ['document-generation', 'outward-grn', 'dispatches'] as const,
};

async function fetchWarehouseStock(): Promise<StockRow[]> {
  const response = await fetch(apiUrl('/api/warehouse/stock?page=1&pageSize=500'), {
    headers: authHeaders(),
  });
  const result = await readJsonResponse<ApiEnvelope<StockRow[]>>(response);
  if (!result.ok) throw new Error(result.error || result.detail || 'Failed to load warehouse stock');
  return result.data ?? [];
}

async function fetchWarehouseOptions(): Promise<WarehouseOption[]> {
  const loadOptions = async (path: string) => {
    const response = await fetch(apiUrl(path), { headers: authHeaders() });
    const result = await readJsonResponse<ApiEnvelope<WarehouseOption[]>>(response);
    if (!result.ok) throw new Error(result.error || result.detail || `Failed to load ${path}`);
    return Array.isArray(result.data) ? result.data : [];
  };
  const [warehouseRows, portRows] = await Promise.all([
    loadOptions('/api/inventory/warehouses'),
    loadOptions('/api/inventory/port-warehouses'),
  ]);
  const rows = [
    ...warehouseRows,
    ...portRows,
  ];
  return rows
    .filter((row) => row?.id && row?.name && row.name !== 'All warehouses')
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      address: row.address ?? null,
      firmsCode: row.firmsCode ?? null,
    }));
}

async function createOutwardDispatch(payload: CreateOutwardDispatchPayload): Promise<OutwardRecord> {
  const response = await fetch(apiUrl('/api/warehouse/outward'), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await readJsonResponse<ApiEnvelope<OutwardRecord>>(response);
  if (!result.ok) throw new Error(result.error || result.detail || 'Failed to create draft GRN');
  return result.data;
}

async function fetchOutwardDispatches(): Promise<OutwardRecord[]> {
  const response = await fetch(apiUrl('/api/warehouse/outward'), {
    headers: authHeaders(),
  });
  const result = await readJsonResponse<ApiEnvelope<OutwardRecord[]>>(response);
  if (!result.ok) throw new Error(result.error || result.detail || 'Failed to load outward dispatches');
  return result.data ?? [];
}

function stringifyDraftValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function isDraftBlank(value: string | undefined): boolean {
  const normalized = (value ?? '').trim();
  return !normalized || normalized === '-' || normalized === '—' || normalized === '–' || normalized === 'â€”';
}

function draftValueOr(...values: Array<string | undefined>): string {
  return values.find(value => !isDraftBlank(value)) ?? '';
}

function outwardDraftToPreviewSchema(draft: DraftPayload, fallbackWarehouse?: WarehouseOption | null): DocGenSchema {
  const baseSchema = DOC_GEN_SCHEMAS['outward-pl'];
  const warehouse = draft.outwardDispatch?.warehouse ?? fallbackWarehouse ?? null;
  const fields: Record<string, string> = {};
  const sections: GenSection[] = draft.sections.map(section => ({
    sectionLabel: section.sectionLabel,
    renderAs: 'fields',
    mappings: section.fields.map(field => {
      const value = stringifyDraftValue(field.value);
      fields[field.targetField] = value;
      const filledManual = field.mappingType === 'manual' && value.trim();
      return {
        targetField: field.targetField,
        targetLabel: field.targetLabel,
        sourceDoc: filledManual ? 'WAREHOUSE_DISPATCH' : field.sourceDoc,
        sourceField: field.sourceField ?? '',
        sourceLabel: filledManual ? 'New Outward Dispatch' : (field.sourceLabel ?? field.sourceDoc),
        mappingType: filledManual ? 'direct' : field.mappingType,
        validation: field.validation ?? undefined,
        validationSeverity: field.validationSeverity ?? undefined,
        mono: field.mono,
      };
    }),
  }));

  const lineMappings: FieldMapping[] = [
    { targetField: 'lineNo', targetLabel: 'Line', sourceDoc: 'CALCULATED', sourceField: 'lineNo', sourceLabel: 'Line number', mappingType: 'derived', mono: true, isLineItem: true },
    { targetField: 'productCode', targetLabel: 'Part Number', sourceDoc: 'WAREHOUSE_STOCK', sourceField: 'productCode', sourceLabel: 'Selected stock/product', mappingType: 'direct', mono: true, isLineItem: true },
    { targetField: 'productDesc', targetLabel: 'Description', sourceDoc: 'WAREHOUSE_STOCK', sourceField: 'productDesc', sourceLabel: 'Selected stock/product', mappingType: 'direct', isLineItem: true },
    { targetField: 'containerNo', targetLabel: 'Container No', sourceDoc: 'BILL_OF_LADING', sourceField: 'containerNo', sourceLabel: 'BOL container matched from selected line', mappingType: 'direct', mono: true, isLineItem: true },
    { targetField: 'deliveryDate', targetLabel: 'Delivery Date', sourceDoc: 'WAREHOUSE_DISPATCH', sourceField: 'deliveryDate', sourceLabel: 'User input', mappingType: 'manual', mono: true, isLineItem: true },
    { targetField: 'totalQtyInPcs', targetLabel: 'Qty Pieces', sourceDoc: 'WAREHOUSE_DISPATCH', sourceField: 'quantityDispatched', sourceLabel: 'User input', mappingType: 'manual', mono: true, isLineItem: true },
    { targetField: 'packageType', targetLabel: 'Package Type', sourceDoc: 'WAREHOUSE_DISPATCH', sourceField: 'packageType', sourceLabel: 'User input / stock package', mappingType: 'manual', isLineItem: true },
    { targetField: 'noOfBundles', targetLabel: 'Bundles', sourceDoc: 'PACKING_LIST', sourceField: 'noOfBundles', sourceLabel: 'Approved Packing List Stock', mappingType: 'direct', mono: true, isLineItem: true },
    { targetField: 'netWeightKgs', targetLabel: 'Net Weight', sourceDoc: 'PACKING_LIST', sourceField: 'netWeightKgs', sourceLabel: 'Approved Packing List Stock', mappingType: 'direct', mono: true, isLineItem: true },
    { targetField: 'grossWeightKgs', targetLabel: 'Gross Weight', sourceDoc: 'PACKING_LIST', sourceField: 'grossWeightKgs', sourceLabel: 'Approved Packing List Stock', mappingType: 'direct', mono: true, isLineItem: true },
  ];

  const lineItems = draft.lineItems.map(row => Object.fromEntries(
    lineMappings.map(mapping => [mapping.targetField, stringifyDraftValue(row[mapping.targetField])]),
  ));
  sections.push({ sectionLabel: 'Line Items', renderAs: 'table', mappings: lineMappings });

  fields.grnDate = draftValueOr(fields.documentDate, fields.grnDate);
  fields.additionalDetails = draftValueOr(fields.additionalDetails, fields.bolRef);
  fields.bolRef = draftValueOr(fields.bolRef, fields.additionalDetails);
  fields.plRef = draftValueOr(fields.plRef, 'Approved Packing List Stock');
  fields.warehouseName = draftValueOr(fields.warehouseName, stringifyDraftValue(warehouse?.name));
  fields.warehouseAddress = draftValueOr(fields.warehouseAddress, stringifyDraftValue(warehouse?.address));
  fields.threePlName = draftValueOr(fields.threePlName, fields.warehouseName);
  fields.threePlAddress = draftValueOr(fields.threePlAddress, fields.warehouseAddress);
  fields.shipperName = draftValueOr(fields.shipperName, fields.warehouseName);
  fields.shipperAddress = draftValueOr(fields.shipperAddress, fields.warehouseAddress);
  fields.shipTo = draftValueOr(fields.shipTo, fields.destinationName, stringifyDraftValue(draft.outwardDispatch?.destinationName));
  fields.shipToAddress = draftValueOr(fields.shipToAddress, fields.destinationAddress, stringifyDraftValue(draft.outwardDispatch?.destinationAddress));
  fields.consigneeName = draftValueOr(fields.consigneeName, 'Unimatics');
  fields.consigneeAddress = draftValueOr(fields.consigneeAddress, 'Unimatics Manufacturing Mx,LLC\n14600 Arville Street\nSloan, NV 89054\nUSA');
  fields.totalBundles = draftValueOr(fields.totalBundles);
  fields.totalNetWeightLbs = draftValueOr(fields.totalNetWeightLbs, fields.totalNetWeightKgs);
  fields.totalGrossWeightLbs = draftValueOr(fields.totalGrossWeightLbs, fields.totalGrossWeightKgs);

  const fieldCount = Object.keys(fields).length;
  const lineCount = lineItems.length * lineMappings.length;
  return {
    ...baseSchema,
    displayName: 'Outward GRN',
    triggerCondition: 'Warehouse outward dispatch created from approved Packing List stock',
    sourceDocs: [
      { docType: 'WAREHOUSE_STOCK', label: 'Approved Packing List Stock' },
      { docType: 'WAREHOUSE_DISPATCH', label: 'New Outward Dispatch' },
    ],
    humanAction: 'Review the outward dispatch and approve the GRN',
    fieldCounts: {
      auto: fieldCount + lineCount,
      calculated: 0,
      manual: 0,
      total: fieldCount + lineCount,
    },
    sections,
    mockData: {
      fields,
      tables: { 'Line Items': lineItems },
    },
  };
}

function StockPickerRow({
  row,
  selected,
  line,
  onToggle,
  onQtyChange,
  onPackageTypeChange,
}: {
  row: StockRow;
  selected: boolean;
  line: DispatchLine | undefined;
  onToggle: () => void;
  onQtyChange: (qty: string) => void;
  onPackageTypeChange: (packageType: string) => void;
}) {
  const qty = line ? Number(line.quantityDispatched) : 0;
  const availableQty = line?.availableQty ?? row.availableQuantity;
  const qtyInvalid = selected && (Number.isNaN(qty) || qty <= 0 || qty > availableQty);

  return (
    <div className={`rounded-lg border p-3 transition-colors ${selected ? 'border-teal-400 bg-teal-50/30 dark:bg-teal-950/10' : 'border-border bg-card hover:border-teal-200'}`}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all ${selected ? 'bg-teal-500 text-white' : 'bg-muted text-muted-foreground hover:bg-teal-100'}`}
        >
          {selected ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-mono font-semibold text-foreground">{row.productCode}</p>
          {row.description && <p className="text-[13px] text-muted-foreground truncate">{row.description}</p>}
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Available: <span className="font-semibold text-teal-600">{fmtAvailable(availableQty)}</span>
          </p>
        </div>
        {selected && (
          <div className="shrink-0 flex items-end gap-2">
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">Package</label>
              <input
                value={line?.packageType ?? ''}
                onChange={(e) => onPackageTypeChange(e.target.value)}
                placeholder="Bundle"
                className="w-28 text-[13px] border border-border rounded-lg px-2 py-1.5 bg-background text-foreground"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">Qty</label>
              <input
                type="number"
                min="1"
                max={availableQty}
                value={line?.quantityDispatched ?? ''}
                onChange={(e) => onQtyChange(e.target.value)}
                placeholder="0"
                className={`w-24 text-[13px] border rounded-lg px-2 py-1.5 bg-background text-foreground text-center ${qtyInvalid ? 'border-red-400' : 'border-border'}`}
              />
            </div>
          </div>
        )}
      </div>
      {qtyInvalid && (
        <p className="text-[12px] text-red-500 mt-1 ml-11">
          {qty > availableQty ? `Max available: ${fmtAvailable(availableQty)}` : 'Enter a valid quantity'}
        </p>
      )}
    </div>
  );
}

function NewDispatchForm({
  stock,
  stockLoading,
  selectedWarehouseId,
  selectedWarehouseName,
  creating,
  onClose,
  onCreate,
  onCreated,
}: {
  stock: StockRow[];
  stockLoading: boolean;
  selectedWarehouseId: string;
  selectedWarehouseName: string;
  creating: boolean;
  onClose: () => void;
  onCreate: (payload: CreateOutwardDispatchPayload) => Promise<OutwardRecord>;
  onCreated: (record: OutwardRecord) => void;
}) {
  const [destinationName, setDestinationName] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [truckNumber, setTruckNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DispatchLine[]>([]);
  const [error, setError] = useState('');

  const groupedStock = useMemo(() => {
    const rowsBySku = new Map<string, StockRow>();
    for (const row of stock) {
      const key = row.productCode || 'UNSPECIFIED';
      const existing = rowsBySku.get(key);
      if (!existing) {
        rowsBySku.set(key, {
          ...row,
          physicalQuantityOnHand: Number(row.physicalQuantityOnHand ?? row.quantityOnHand ?? 0),
        });
        continue;
      }
      existing.quantityOnHand += Number(row.quantityOnHand || 0);
      existing.physicalQuantityOnHand = Number(existing.physicalQuantityOnHand ?? 0) + Number(row.physicalQuantityOnHand ?? row.quantityOnHand ?? 0);
      existing.reservedQuantity += Number(row.reservedQuantity || 0);
      existing.availableQuantity += Number(row.availableQuantity || 0);
      existing.netWeightKg += Number(row.netWeightKg || 0);
      existing.description = existing.description || row.description;
      existing.hsCode = existing.hsCode || row.hsCode;
    }
    return Array.from(rowsBySku.values()).filter((row) => row.availableQuantity > 0);
  }, [stock]);

  function toggleStock(row: StockRow) {
    setLines((prev) => {
      const exists = prev.find((line) => line.productCode === row.productCode);
      if (exists) return prev.filter((line) => line.productCode !== row.productCode);
      const skuRows = stock.filter((item) => item.productCode === row.productCode);
      const totalAvailable = skuRows.reduce((sum, item) => sum + Number(item.availableQuantity || 0), 0);
      const totalOnHand = skuRows.reduce((sum, item) => sum + Number(item.physicalQuantityOnHand ?? item.quantityOnHand ?? 0), 0);
      const totalNetWeight = skuRows.reduce((sum, item) => sum + Number(item.netWeightKg || 0), 0);
      const stockAllocations = skuRows
        .map((item) => ({
          warehouseStockId: item.id,
          availableQty: Number(item.availableQuantity || 0),
        }))
        .filter((item) => item.availableQty > 0);
      return [
        ...prev,
        {
          warehouseStockId: row.id,
          stockAllocations,
          productCode: row.productCode,
          description: row.description || '',
          availableQty: totalAvailable,
          netWeightPerUnit: totalOnHand > 0 ? totalNetWeight / totalOnHand : 0,
          quantityDispatched: '',
          netWeightKg: '',
          packageType: '',
        },
      ];
    });
  }

  function setQty(productCode: string, qty: string) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.productCode !== productCode) return line;
        const numQty = Number(qty);
        const estWeight = !Number.isNaN(numQty) && numQty > 0 && line.netWeightPerUnit > 0
          ? (numQty * line.netWeightPerUnit).toFixed(2)
          : line.netWeightKg;
        return { ...line, quantityDispatched: qty, netWeightKg: estWeight };
      }),
    );
  }

  async function handleSubmit() {
    setError('');
    if (!destinationName.trim()) {
      setError('Destination name is required');
      return;
    }
    if (!selectedWarehouseId) {
      setError('Select a warehouse');
      return;
    }
    if (lines.length === 0) {
      setError('Select at least one product to dispatch');
      return;
    }
    for (const line of lines) {
      const qty = Number(line.quantityDispatched);
      if (Number.isNaN(qty) || qty <= 0 || qty > line.availableQty) {
        setError(`Invalid quantity for ${line.productCode}. Must be between 1 and ${fmtAvailable(line.availableQty)}`);
        return;
      }
    }

    try {
      const payloadLines = lines.flatMap((line) => {
        const requestedQty = Number(line.quantityDispatched);
        let remaining = requestedQty;
        const totalNetWeight = Number(line.netWeightKg) || 0;
        const allocations = line.stockAllocations.length
          ? line.stockAllocations
          : [{ warehouseStockId: line.warehouseStockId, availableQty: line.availableQty }];

        return allocations.flatMap((allocation) => {
          if (remaining <= 0) return [];
          const quantityDispatched = Math.min(remaining, allocation.availableQty);
          remaining -= quantityDispatched;
          return [{
            warehouseStockId: allocation.warehouseStockId,
            quantityDispatched,
            netWeightKg: totalNetWeight > 0 && requestedQty > 0
              ? Number((totalNetWeight * (quantityDispatched / requestedQty)).toFixed(2))
              : undefined,
            packageType: line.packageType.trim() || undefined,
          }];
        });
      });

      const payload = {
        warehouseId: selectedWarehouseId,
        destinationName: destinationName.trim(),
        destinationAddress: destinationAddress.trim() || undefined,
        deliveryDate: deliveryDate || undefined,
        truckNumber: truckNumber.trim() || undefined,
        driverName: driverName.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: payloadLines,
      };

      const record = await onCreate(payload);
      setDestinationName('');
      setDestinationAddress('');
      setDeliveryDate('');
      setTruckNumber('');
      setDriverName('');
      setNotes('');
      setLines([]);
      onCreated(record);
    } catch (err: any) {
      setError(err.message || 'Failed to create draft GRN');
    }
  }

  function setPackageType(productCode: string, packageType: string) {
    setLines((prev) => prev.map((line) => (
      line.productCode === productCode ? { ...line, packageType } : line
    )));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-5">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[calc(100vh-40px)] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-[14.5px] font-semibold text-foreground">New Outward Dispatch</h2>
            <p className="text-[13px] text-muted-foreground">Create a draft GRN from {selectedWarehouseName || 'selected warehouse'} stock</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <section>
            <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5" /> Destination & Vehicle
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">
                  Destination Name <span className="text-red-400">*</span>
                </label>
                <input value={destinationName} onChange={(e) => setDestinationName(e.target.value)} placeholder="e.g. Chicago Steel Fabricators" className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">Destination Address</label>
                <textarea value={destinationAddress} onChange={(e) => setDestinationAddress(e.target.value)} placeholder="Street, City, State, ZIP" rows={2} className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground resize-none" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-1">Delivery Date</label>
                  <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-1">Truck / Vehicle No.</label>
                  <input value={truckNumber} onChange={(e) => setTruckNumber(e.target.value)} placeholder="e.g. TRK-2024-LA01" className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-1">Driver Name</label>
                  <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="e.g. John Smith" className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional dispatch notes..." rows={2} className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground resize-none" />
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" /> Select Products to Dispatch
            </h3>
            {stockLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-muted/40 animate-pulse" />)}
              </div>
            ) : groupedStock.length === 0 ? (
              <div className="rounded-lg border border-border p-6 text-center">
                <Package className="w-6 h-6 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-[13px] text-muted-foreground">No stock available to dispatch</p>
              </div>
            ) : (
              <div className="space-y-2">
                {groupedStock.map((row) => {
                  const line = lines.find((item) => item.productCode === row.productCode);
                  return (
                    <StockPickerRow
                      key={row.id}
                      row={row}
                      selected={!!line}
                      line={line}
                      onToggle={() => toggleStock(row)}
                      onQtyChange={(qty) => setQty(row.productCode, qty)}
                      onPackageTypeChange={(packageType) => setPackageType(row.productCode, packageType)}
                    />
                  );
                })}
              </div>
            )}
          </section>

          {lines.length > 0 && (
            <div className="rounded-lg bg-teal-50/50 dark:bg-teal-950/10 border border-teal-200 dark:border-teal-800 p-3">
              <p className="text-[13px] font-semibold text-teal-700 dark:text-teal-400 mb-1">
                Dispatch Summary - {lines.length} line{lines.length !== 1 ? 's' : ''}
              </p>
              {lines.map((line) => (
                <div key={line.warehouseStockId} className="flex items-center justify-between text-[13px] text-muted-foreground py-0.5">
                  <span className="font-mono">{line.productCode}</span>
                  <span className="font-semibold text-foreground">
                    {line.quantityDispatched || '-'} units{line.netWeightKg ? ` - ${Number(line.netWeightKg).toFixed(1)} kg` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-[13px] text-red-600 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2 border border-red-200 dark:border-red-900">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border bg-muted/20 shrink-0">
          <button onClick={onClose} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={creating || lines.length === 0} className="flex items-center gap-1.5 px-4 py-2 text-[14.5px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors">
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {creating ? 'Creating...' : 'Create Draft GRN'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
    CONFIRMED: 'bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400',
    DISPATCHED: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400',
  };
  return (
    <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${map[status] || 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

function OutwardRecordCard({
  record,
  onPreview,
}: {
  record: OutwardRecord;
  onPreview: (record: OutwardRecord) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = record.lines ?? [];

  return (
    <div className={`bg-card rounded-xl border transition-colors ${record.status === 'DRAFT' ? 'border-amber-200 dark:border-amber-800' : 'border-border'}`}>
      <div className="flex items-center gap-3 p-4">
        <div className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center shrink-0">
          {record.status === 'CONFIRMED' || record.status === 'DISPATCHED'
            ? <CheckCircle2 className="w-5 h-5 text-teal-500" />
            : <Truck className="w-5 h-5 text-amber-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={record.status} />
            <span className="text-[13px] font-mono text-muted-foreground">
              {record.id.slice(-8).toUpperCase()}
            </span>
          </div>
          <p className="text-[14.5px] font-medium text-foreground mt-0.5 truncate">
            {record.destinationName || 'No destination set'}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {record.warehouse?.name && <span className="mr-2">Warehouse: {record.warehouse.name}</span>}
            {record.truckNumber && <span className="mr-2">Truck: {record.truckNumber}</span>}
            {record.driverName && <span className="mr-2">{record.driverName}</span>}
            <span>{fmtDate(record.createdAt)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {record.draftPayload && (
            <button
              type="button"
              onClick={() => onPreview(record)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[13px] rounded-lg border border-border hover:bg-muted text-muted-foreground transition-colors"
            >
              <FileText className="w-3 h-3" /> GRN Doc
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-3">
          <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Dispatch Lines ({lines.length})
          </p>
          {lines.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No lines</p>
          ) : (
            <div className="space-y-1">
              {lines.map((line) => (
                <div key={line.id} className="flex items-center justify-between text-[13px] py-1 border-b border-border/40 last:border-0">
                  <div className="min-w-0">
                    <span className="font-mono font-medium text-foreground">
                      {line.warehouseStock?.productCode || 'Unknown'}
                    </span>
                    {line.warehouseStock?.description && (
                      <span className="text-muted-foreground ml-2">{line.warehouseStock.description}</span>
                    )}
                  </div>
                  <div className="text-right text-muted-foreground shrink-0">
                    <span className="font-semibold text-foreground">{fmtAvailable(line.quantityDispatched)} units</span>
                    {line.netWeightKg > 0 && (
                      <span className="ml-2">{Number(line.netWeightKg).toFixed(1)} kg</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {record.destinationAddress && (
            <p className="text-[13px] text-muted-foreground mt-2">
              <span className="font-medium">Address:</span> {record.destinationAddress}
            </p>
          )}
          {record.notes && (
            <p className="text-[13px] text-muted-foreground mt-1">
              <span className="font-medium">Notes:</span> {record.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function DocumentGenerationOutwardGrnPage() {
  const [location, navigate] = useLocation();
  const fromDocGeneration = location.startsWith('/documents/generate');
  const { activities, docTypes, documentScope, activityDocTypes } = usePermissions();
  const generationOptions = allowedDocGenerationOptions({ activities, docTypes, documentScope, activityDocTypes });
  const canAccessOutwardGrn = generationOptions.some((option) => option.type === 'outward-grn');
  const queryClient = useQueryClient();
  const stockQuery = useQuery({
    queryKey: outwardGrnQueryKeys.stock,
    queryFn: fetchWarehouseStock,
    staleTime: 30_000,
  });
  const warehousesQuery = useQuery({
    queryKey: outwardGrnQueryKeys.warehouses,
    queryFn: fetchWarehouseOptions,
    staleTime: 60_000,
  });
  const dispatchesQuery = useQuery({
    queryKey: outwardGrnQueryKeys.dispatches,
    queryFn: fetchOutwardDispatches,
    staleTime: 30_000,
  });
  const createDispatchMutation = useMutation({
    mutationFn: createOutwardDispatch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: outwardGrnQueryKeys.stock });
      queryClient.invalidateQueries({ queryKey: outwardGrnQueryKeys.dispatches });
    },
  });
  const stock = stockQuery.data ?? [];
  const warehouseOptions = warehousesQuery.data ?? [];
  const records = dispatchesQuery.data ?? [];

  const backHref = fromDocGeneration ? '/documents/generate' : '/inventory/warehouse';
  const crumbRoot = fromDocGeneration ? 'Documents' : 'Warehouse';
  const crumbRootHref = fromDocGeneration ? '/documents/generate' : '/inventory/warehouse';
  const fallbackGenerationType = generationOptions[0]?.type;
  const [previewSchema, setPreviewSchema] = useState<DocGenSchema | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'ALL' | OutwardRecord['status']>('ALL');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');

  useEffect(() => {
    if (warehouseOptions.length === 0) return;
    setSelectedWarehouseId((current) => (
      warehouseOptions.some((option) => option.id === current) ? current : warehouseOptions[0].id
    ));
  }, [warehouseOptions]);

  const filteredRecords = useMemo(
    () => records.filter((record) => filterStatus === 'ALL' || record.status === filterStatus),
    [filterStatus, records],
  );
  const drafts = filteredRecords.filter((record) => record.status === 'DRAFT');
  const others = filteredRecords.filter((record) => record.status !== 'DRAFT');
  const selectedWarehouse = warehouseOptions.find((option) => option.id === selectedWarehouseId);

  function openDraftPreview(record: OutwardRecord) {
    if (!record.draftPayload) return;
    setPreviewSchema(outwardDraftToPreviewSchema(record.draftPayload, record.warehouse ?? selectedWarehouse));
  }

  useEffect(() => {
    if (!fromDocGeneration || canAccessOutwardGrn || !fallbackGenerationType) return;
    navigate(`/documents/generate/${fallbackGenerationType}`);
  }, [canAccessOutwardGrn, fallbackGenerationType, fromDocGeneration, navigate]);

  if (fromDocGeneration && !canAccessOutwardGrn) {
    if (fallbackGenerationType) return null;
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <AlertCircle className="w-6 h-6 mx-auto text-red-500 mb-2" />
          <h1 className="text-[15px] font-semibold text-foreground">Access denied</h1>
          <p className="text-[13px] text-muted-foreground mt-1">No generated document types are assigned to this role.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {fromDocGeneration && (
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div>
            <h1 className="text-[15px] font-semibold text-foreground">Document Generation</h1>
            <p className="text-[12px] text-muted-foreground">AI-drafted documents for review & approval</p>
          </div>
          <div className="flex items-center gap-1 ml-4 p-1 rounded-lg bg-muted/60">
            {generationOptions.map((option) => {
              const active = option.type === 'outward-grn';
              return (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => navigate(`/documents/generate/${option.type}`)}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${active ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground mb-4">
            <Link href={crumbRootHref} className="hover:text-foreground">{crumbRoot}</Link>
            <span>/</span>
            <span className="text-foreground">Outward GRN</span>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={backHref}>
              <button className="text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
            </Link>
            <h1 className="text-xl font-semibold text-foreground">Outward GRN</h1>
          </div>
          <p className="text-[14.5px] text-muted-foreground">
            Record outward dispatches and review the draft GRN document for each reference.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedWarehouseId}
            onChange={(event) => setSelectedWarehouseId(event.target.value)}
            aria-label="Warehouse or port location"
            title={selectedWarehouse?.name}
            disabled={warehousesQuery.isLoading || warehouseOptions.length === 0}
            className="h-9 w-full min-w-[320px] max-w-[390px] rounded-lg border border-primary bg-background px-4 text-sm text-foreground outline-none disabled:opacity-60"
          >
            {warehouseOptions.length === 0 ? (
              <option value="">No warehouses configured</option>
            ) : warehouseOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            disabled={!selectedWarehouseId}
            className="flex items-center gap-1.5 px-4 py-2 text-[14.5px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Dispatch
          </button>
          {warehousesQuery.isError && (
            <div className="basis-full text-[13px] text-red-600">
              {warehousesQuery.error instanceof Error ? warehousesQuery.error.message : 'Failed to load warehouse settings'}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-1 bg-muted/30 rounded-xl p-1 w-fit">
        {(['ALL', 'DRAFT', 'CONFIRMED', 'DISPATCHED'] as const).map((status) => {
          const draftCount = records.filter((record) => record.status === 'DRAFT').length;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors ${
                filterStatus === status
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {status === 'ALL' ? 'All' : status.charAt(0) + status.slice(1).toLowerCase()}
              {status === 'DRAFT' && draftCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[12px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                  {draftCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {dispatchesQuery.isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-20 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {dispatchesQuery.isError && (
        <div className="flex items-center gap-2 text-[14.5px] text-red-600 bg-red-50 dark:bg-red-950/20 rounded-lg px-4 py-3 border border-red-200 dark:border-red-900">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {dispatchesQuery.error instanceof Error ? dispatchesQuery.error.message : 'Failed to load outward dispatches'}
        </div>
      )}

      {!dispatchesQuery.isLoading && !dispatchesQuery.isError && filteredRecords.length === 0 && (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <Send className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-[14.5px] font-medium text-foreground mb-1">No outward dispatch records yet</p>
          <p className="text-[13px] text-muted-foreground mb-4">
            Create a draft outward GRN when you are ready to dispatch approved Packing List stock.
          </p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            disabled={!selectedWarehouseId}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Dispatch
          </button>
        </div>
      )}

      {!dispatchesQuery.isLoading && !dispatchesQuery.isError && filteredRecords.length > 0 && (
        <div className="space-y-3">
          {drafts.length > 0 && (
            <>
              <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                Draft Outward GRN ({drafts.length})
              </p>
              {drafts.map((record) => (
                <OutwardRecordCard key={record.id} record={record} onPreview={openDraftPreview} />
              ))}
            </>
          )}
          {others.length > 0 && (
            <>
              {drafts.length > 0 && <div className="h-px bg-border" />}
              <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal-500 inline-block" />
                Confirmed & Dispatched ({others.length})
              </p>
              {others.map((record) => (
                <OutwardRecordCard key={record.id} record={record} onPreview={openDraftPreview} />
              ))}
            </>
          )}
        </div>
      )}

      {showForm && (
        <NewDispatchForm
          stock={stock}
          stockLoading={stockQuery.isLoading}
          selectedWarehouseId={selectedWarehouseId}
          selectedWarehouseName={selectedWarehouse?.name ?? ''}
          creating={createDispatchMutation.isPending}
          onClose={() => setShowForm(false)}
          onCreate={(payload) => createDispatchMutation.mutateAsync(payload)}
          onCreated={(record) => {
            toast.success('Draft Outward GRN created');
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['upload-process', 'generated-drafts'] });
            if (record.draftPayload) {
              setPreviewSchema(outwardDraftToPreviewSchema(record.draftPayload, record.warehouse ?? selectedWarehouse));
            }
          }}
        />
      )}
      {previewSchema && (
        <DocumentPreviewModal
          schema={previewSchema}
          manualValues={{}}
          computedFields={{}}
          computedRowMap={{}}
          isApproved={false}
          onClose={() => setPreviewSchema(null)}
        />
      )}
    </div>
  );
}
