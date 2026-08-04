import { useState, useEffect } from 'react';
import { X, Package, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LineItem {
  hsn_code: string;
  hsn_code_destination?: string;
  product_code: string;
  product_description: string;
  product_specification?: string;
  product_sku?: string;
  container_no?: string;
  quantity: number;
  unit: string;
  rate?: number;
  line_total?: number;
  no_of_packages?: number;
  // editable fields
  qty_per_bundle: number | '';
  no_of_bundles: number | '';
  net_weight_total: number | '';
  gross_weight_total: number | '';
  package_type: string;
}

interface ManualFields {
  gross_weight: number | '';
  package_count: number | '';
  dimensions: string;
}

interface PlFormData {
  manual_fields: ManualFields;
  line_items: LineItem[];
}

interface DraftPl {
  id: string;
  documentType: string;
  status: string;
  ocrExtractedData?: Record<string, any>;
  generatedFrom?: { sales_invoice_id: string };
}

interface Props {
  open: boolean;
  draftPl: DraftPl | null;
  onClose: () => void;
  onSubmit: (draftPlId: string, formData: PlFormData) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PACKAGE_TYPES = ['Box', 'Carton', 'Pallet', 'Crate', 'Bundle'];

function ReadonlyField({
  label,
  value,
  variant = 'default',
}: {
  label: string;
  value: string | number | boolean | undefined | null;
  variant?: 'default' | 'si' | 'calculated';
}) {
  const display = value === true ? 'Yes' : value === false ? 'No' : (value ?? '—');
  const cls =
    variant === 'si'
      ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30'
      : variant === 'calculated'
      ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-900 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30'
      : 'bg-gray-50 dark:bg-gray-900/30 text-muted-foreground border border-transparent';
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      <div className={`px-2.5 py-1.5 text-[14.5px] rounded-md min-h-[32px] break-words cursor-not-allowed ${cls}`}>
        {String(display)}
      </div>
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
}: {
  label: string;
  value: string | number | '';
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  error?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-2.5 py-1.5 text-[14.5px] text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 rounded-md border-2 min-h-[32px] cursor-text focus:outline-none focus:ring-2 focus:ring-rose-500 dark:focus:ring-rose-400/50 hover:border-rose-400 transition-colors ${
          error ? 'border-red-500 ring-2 ring-red-400' : 'border-rose-300 dark:border-rose-500/30'
        }`}
      />
    </div>
  );
}

function SectionHeader({
  title,
  open,
  onToggle,
  badge,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/50 hover:bg-muted transition-colors rounded-md"
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold uppercase tracking-wider text-foreground">{title}</span>
        {badge && (
          <span className="text-[12px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{badge}</span>
        )}
      </div>
      {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DraftPlEditForm({ open, draftPl, onClose, onSubmit }: Props) {
  const [formData, setFormData] = useState<PlFormData>({
    manual_fields: { gross_weight: '', package_count: '', dimensions: '' },
    line_items: [],
  });
  const [errors, setErrors] = useState<{ gross_weight?: boolean; package_count?: boolean }>({});
  const [isDirty, setIsDirty] = useState(false);

  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({
    doc_header: false,
    compliance: true,
    entities: false,
    header: false,
    shipment: false,
    footer: false,
    totals: false,
    line_items: true,
  });

  useEffect(() => {
    if (open && draftPl) {
      const ocr = draftPl.ocrExtractedData ?? {};
      const raw: any[] = ocr.line_items ?? [];
      const lineItems: LineItem[] = raw.map(item => ({
        hsn_code: item.hsn_code ?? '',
        hsn_code_destination: item.hsn_code_destination ?? '',
        product_code: item.product_code ?? item.product_sku ?? '',
        product_description: item.product_description ?? '',
        product_specification: item.product_specification ?? '',
        product_sku: item.product_sku ?? '',
        quantity: item.quantity ?? 0,
        unit: item.unit ?? '',
        rate: item.rate,
        line_total: item.line_total,
        no_of_packages: item.no_of_packages,
        qty_per_bundle: '',
        no_of_bundles: item.no_of_packages ?? '',
        net_weight_total: '',
        gross_weight_total: '',
        package_type: 'Bundle',
      }));
      setFormData({
        manual_fields: { gross_weight: '', package_count: '', dimensions: '' },
        line_items: lineItems,
      });
      setErrors({});
      setIsDirty(false);
    }
  }, [open, draftPl?.id]);

  function toggleSection(key: string) {
    setSectionsOpen(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function updateManual(field: keyof ManualFields, value: string) {
    setFormData(prev => ({
      ...prev,
      manual_fields: { ...prev.manual_fields, [field]: value },
    }));
    setIsDirty(true);
    if (field === 'gross_weight' || field === 'package_count') {
      setErrors(prev => ({ ...prev, [field]: false }));
    }
  }

  function updateLineItem(idx: number, field: keyof LineItem, value: string) {
    setFormData(prev => {
      const items = [...prev.line_items];
      items[idx] = { ...items[idx], [field]: value };
      return { ...prev, line_items: items };
    });
    setIsDirty(true);
  }

  function handleSaveDraft() {
    toast.success('Draft saved');
  }

  function handleSubmit() {
    const newErrors: typeof errors = {};
    if (!String(formData.manual_fields.gross_weight).trim()) {
      newErrors.gross_weight = true;
    }
    if (!String(formData.manual_fields.package_count).trim()) {
      newErrors.package_count = true;
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      toast.error('Please fill all required fields before submitting.');
      return;
    }
    if (draftPl) {
      onSubmit(draftPl.id, formData);
    }
    toast.success('Packing List submitted successfully');
    onClose();
  }

  function handleCancel() {
    if (isDirty) {
      if (window.confirm('Discard changes?')) {
        onClose();
      }
    } else {
      onClose();
    }
  }

  // Computed totals
  const totalBundles = formData.line_items.reduce((s, it) => s + (Number(it.no_of_bundles) || 0), 0);
  const totalQty = formData.line_items.reduce((s, it) => {
    const qty = (Number(it.qty_per_bundle) || 0) * (Number(it.no_of_bundles) || 0);
    return s + qty;
  }, 0);
  const totalNetWeight = formData.line_items.reduce((s, it) => s + (Number(it.net_weight_total) || 0), 0);
  const totalGrossWeight = formData.line_items.reduce((s, it) => s + (Number(it.gross_weight_total) || 0), 0);

  if (!draftPl) return null;

  const ocr = draftPl.ocrExtractedData ?? {};
  const status = draftPl.status ?? 'DRAFT';
  const isSubmitted = status === 'PL_GENERATED';

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) handleCancel(); }}>
      <SheetContent
        side="right"
        className="flex flex-col p-0 overflow-hidden"
        style={{ width: 720, maxWidth: '95vw' }}
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-5 pb-4 border-b flex-shrink-0" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Package className="w-4 h-4 text-primary" />
              </div>
              <div>
                <SheetTitle className="text-[14.5px] font-bold">Draft O-PL Editor</SheetTitle>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Invoice {ocr.invoice_no ?? '—'} · {ocr.org ?? ocr.exporter_name ?? '—'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isSubmitted ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[13px] font-bold rounded-full bg-green-100 text-green-700 border border-green-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  PL GENERATED
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[13px] font-bold rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                  DRAFT
                </span>
              )}
              {!isSubmitted && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="px-3 py-1.5 text-[13px] font-semibold rounded-lg text-white transition-colors hover:opacity-90"
                  style={{ background: 'hsl(var(--vs-teal, 173 58% 39%))' }}
                >
                  Submit Packing List
                </button>
              )}
              <button
                onClick={handleCancel}
                className="p-1 rounded hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">

          {/* ── Section 8: Manual Fields (top, highlighted) ── */}
          <div className="rounded-lg border-2 border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-3 h-3 rounded-full bg-rose-500 animate-pulse flex-shrink-0" />
              <span className="text-[13px] font-bold text-rose-900 dark:text-rose-300 uppercase tracking-wide">
                Manual Fields — Required for Submission
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Gross Weight */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Gross Weight (kg) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  value={formData.manual_fields.gross_weight}
                  onChange={e => updateManual('gross_weight', e.target.value)}
                  placeholder="Enter gross weight"
                  className={`w-full px-3 py-2 text-[14.5px] text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 rounded-md border-2 min-h-[34px] cursor-text focus:outline-none focus:ring-2 focus:ring-rose-500 dark:focus:ring-rose-400/50 hover:border-rose-400 transition-colors ${
                    errors.gross_weight ? 'border-red-500 ring-2 ring-red-400' : 'border-rose-300 dark:border-rose-500/30'
                  }`}
                />
              </div>
              {/* Package Count */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Package Count <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  value={formData.manual_fields.package_count}
                  onChange={e => updateManual('package_count', e.target.value)}
                  placeholder="Enter package count"
                  className={`w-full px-3 py-2 text-[14.5px] text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 rounded-md border-2 min-h-[34px] cursor-text focus:outline-none focus:ring-2 focus:ring-rose-500 dark:focus:ring-rose-400/50 hover:border-rose-400 transition-colors ${
                    errors.package_count ? 'border-red-500 ring-2 ring-red-400' : 'border-rose-300 dark:border-rose-500/30'
                  }`}
                />
              </div>
              {/* Dimensions */}
              <div className="flex flex-col gap-0.5">
                <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Dimensions (LxWxH cm)
                </label>
                <input
                  type="text"
                  value={formData.manual_fields.dimensions}
                  onChange={e => updateManual('dimensions', e.target.value)}
                  placeholder="e.g., 100x80x60"
                  className="w-full px-3 py-2 text-[14.5px] text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 rounded-md border-2 border-rose-300 dark:border-rose-500/30 min-h-[34px] cursor-text focus:outline-none focus:ring-2 focus:ring-rose-500 dark:focus:ring-rose-400/50 hover:border-rose-400 transition-colors"
                />
              </div>
            </div>
            {(errors.gross_weight || errors.package_count) && (
              <p className="text-[13px] text-red-600 flex items-center gap-1 mt-1">
                <AlertCircle className="w-3 h-3" />
                Gross Weight and Package Count are required before submission.
              </p>
            )}
          </div>

          {/* ── Section: Document Header ── */}
          <div className="space-y-1">
            <SectionHeader title="Document Header" open={sectionsOpen.doc_header} onToggle={() => toggleSection('doc_header')} badge="PL document details" />
            {sectionsOpen.doc_header && (
              <div className="px-1 pt-2 pb-3 space-y-3">
                {/* Row 1: Exporter + Invoice + Exporter Ref */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="border rounded p-2">
                    <div className="text-[12px] font-bold mb-1">Exporter:</div>
                    <ReadonlyField label="" value={ocr.exporter_name} variant="si" />
                    <ReadonlyField label="" value={ocr.exporter_address} variant="si" />
                  </div>
                  <div className="border rounded p-2">
                    <div className="text-[12px] font-bold mb-1">Invoice No. & Date:</div>
                    <ReadonlyField label="" value={ocr.invoice_no} variant="si" />
                    <ReadonlyField label="" value={ocr.invoice_date} variant="si" />
                    <div className="text-[12px] font-bold mt-2 mb-1">Buyers Order No. & Date:</div>
                    <ReadonlyField label="" value={ocr.buyer_po_no} variant="si" />
                    <ReadonlyField label="" value={ocr.buyer_po_date} variant="si" />
                  </div>
                  <div className="border rounded p-2">
                    <div className="text-[12px] font-bold mb-1">Exporter&apos;s Ref:</div>
                    <ReadonlyField label="IEC#" value={ocr.iec} variant="si" />
                    <ReadonlyField label="GST No." value={ocr.gstin} variant="si" />
                  </div>
                </div>

                {/* Row 2: Consignee + Buyer + Other Ref */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="border rounded p-2">
                    <div className="text-[12px] font-bold mb-1">Consignee:</div>
                    <ReadonlyField label="" value={ocr.consignee_name} variant="si" />
                    <ReadonlyField label="" value={ocr.consignee_address} variant="si" />
                  </div>
                  <div className="border rounded p-2">
                    <div className="text-[12px] font-bold mb-1">Buyer:</div>
                    <ReadonlyField label="" value={ocr.buyer_name} variant="si" />
                    <ReadonlyField label="" value={ocr.buyer_address} variant="si" />
                  </div>
                  <div className="border rounded p-2">
                    <div className="text-[12px] font-bold mb-1">Other Reference(s):</div>
                    <ReadonlyField label="" value={ocr.reference_1 || '—'} variant="si" />
                    <div className="text-[12px] font-bold mt-2 mb-1">Pickup Address:</div>
                    <ReadonlyField label="" value={ocr.pickup_address || '—'} variant="si" />
                  </div>
                </div>

                {/* Row 3: Transport details - 4 columns */}
                <div className="grid grid-cols-4 gap-2 text-[13px]">
                  <div>
                    <ReadonlyField label="Pre-Carriage by" value={ocr.pre_carriage_by || 'ROAD'} variant="si" />
                    <ReadonlyField label="Vessel/Flight No." value={ocr.vessel_flight_no || 'BY SEA'} variant="si" />
                    <ReadonlyField label="Port of Discharge" value={ocr.port_of_discharge} variant="si" />
                  </div>
                  <div>
                    <ReadonlyField label="Place of Receipt by Pre-Carrier" value={ocr.place_of_receipt} variant="si" />
                    <ReadonlyField label="Port of Loading" value={ocr.port_of_loading} variant="si" />
                    <ReadonlyField label="Final Destination" value={ocr.final_destination} variant="si" />
                  </div>
                  <div>
                    <ReadonlyField label="Country of Origin of Goods" value={ocr.country_of_origin || 'INDIA'} variant="si" />
                  </div>
                  <div>
                    <ReadonlyField label="Country of Final Destination" value={ocr.country_of_final_destination || 'USA'} variant="si" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Section 1: Compliance ── */}
          <div className="space-y-1">
            <SectionHeader title="Compliance" open={sectionsOpen.compliance} onToggle={() => toggleSection('compliance')} badge="2 fields" />
            {sectionsOpen.compliance && (
              <div className="grid grid-cols-2 gap-3 px-1 pt-2 pb-3">
                <ReadonlyField label="GSTIN" value={ocr.gstin} variant="si" />
                <ReadonlyField label="Signature" value={ocr.signature} variant="si" />
              </div>
            )}
          </div>

          {/* ── Section 2: Entities ── */}
          <div className="space-y-1">
            <SectionHeader title="Entities" open={sectionsOpen.entities} onToggle={() => toggleSection('entities')} badge="8 fields" />
            {sectionsOpen.entities && (
              <div className="grid grid-cols-2 gap-3 px-1 pt-2 pb-3">
                <ReadonlyField label="Buyer Name" value={ocr.buyer_name} variant="si" />
                <ReadonlyField label="Buyer Address" value={ocr.buyer_address} variant="si" />
                <ReadonlyField label="Consignee Name" value={ocr.consignee_name} variant="si" />
                <ReadonlyField label="Consignee Address" value={ocr.consignee_address} variant="si" />
                <ReadonlyField label="Exporter Name" value={ocr.exporter_name} variant="si" />
                <ReadonlyField label="Exporter Address" value={ocr.exporter_address} variant="si" />
                <ReadonlyField label="IEC Number" value={ocr.iec} variant="si" />
                <ReadonlyField label="Ship To Address" value={ocr.ship_to} variant="si" />
              </div>
            )}
          </div>

          {/* ── Section 3: Header ── */}
          <div className="space-y-1">
            <SectionHeader title="Header" open={sectionsOpen.header} onToggle={() => toggleSection('header')} badge="8 fields" />
            {sectionsOpen.header && (
              <div className="grid grid-cols-2 gap-3 px-1 pt-2 pb-3">
                <ReadonlyField label="Invoice No" value={ocr.invoice_no} variant="si" />
                <ReadonlyField label="Invoice Date" value={ocr.invoice_date} variant="si" />
                <ReadonlyField label="PO Number" value={ocr.buyer_po_no} variant="si" />
                <ReadonlyField label="PO Date" value={ocr.buyer_po_date} variant="si" />
                <ReadonlyField label="Reference 1" value={ocr.reference_1 ?? ocr.payment_terms} variant="si" />
                <ReadonlyField label="Reference 2" value={ocr.reference_2 ?? ocr.incoterms} variant="si" />
                <ReadonlyField label="Reference 3" value={ocr.reference_3 ?? ocr.currency} variant="si" />
                <ReadonlyField label="Reference 4" value={ocr.reference_4 ?? ''} variant="si" />
              </div>
            )}
          </div>

          {/* ── Section 4: Shipment ── */}
          <div className="space-y-1">
            <SectionHeader title="Shipment" open={sectionsOpen.shipment} onToggle={() => toggleSection('shipment')} badge="8 fields" />
            {sectionsOpen.shipment && (
              <div className="grid grid-cols-2 gap-3 px-1 pt-2 pb-3">
                <ReadonlyField label="Port of Loading" value={ocr.port_of_loading} variant="si" />
                <ReadonlyField label="Port of Discharge" value={ocr.port_of_discharge} variant="si" />
                <ReadonlyField label="Vessel Name" value={ocr.vessel_flight_no ?? ocr.vessel_name} variant="si" />
                <ReadonlyField label="Voyage Number" value={ocr.voyage_number} variant="si" />
                <ReadonlyField label="Country of Origin" value={ocr.country_of_origin} variant="si" />
                <ReadonlyField label="Country of Destination" value={ocr.country_of_final_destination} variant="si" />
                <ReadonlyField label="Pre-carriage By" value={ocr.pre_carriage_by} variant="si" />
                <ReadonlyField label="Place of Receipt" value={ocr.place_of_receipt} variant="si" />
              </div>
            )}
          </div>

          {/* ── Section 5: Footer ── */}
          <div className="space-y-1">
            <SectionHeader title="Footer" open={sectionsOpen.footer} onToggle={() => toggleSection('footer')} badge="3 fields" />
            {sectionsOpen.footer && (
              <div className="grid grid-cols-3 gap-3 px-1 pt-2 pb-3">
                <ReadonlyField label="Signatory Name" value={ocr.signatory_name} variant="si" />
                <ReadonlyField label="Signatory Designation" value={ocr.signatory_designation} variant="si" />
                <ReadonlyField label="DIN Number" value={ocr.din_number} variant="si" />
              </div>
            )}
          </div>

          {/* ── Section 6: Totals ── */}
          <div className="space-y-1">
            <SectionHeader title="Totals" open={sectionsOpen.totals} onToggle={() => toggleSection('totals')} badge="4 fields · auto-calculated" />
            {sectionsOpen.totals && (
              <div className="grid grid-cols-4 gap-3 px-1 pt-2 pb-3">
                <ReadonlyField label="Total Bundles" value={totalBundles || ocr.total_bundles} variant="calculated" />
                <ReadonlyField label="Total Quantity" value={totalQty || ocr.total_quantity} variant="calculated" />
                <ReadonlyField label="Total Net Weight" value={totalNetWeight > 0 ? totalNetWeight.toFixed(2) : (ocr.gross_weight ?? '—')} variant="calculated" />
                <ReadonlyField label="Total Gross Weight" value={totalGrossWeight > 0 ? totalGrossWeight.toFixed(2) : (ocr.gross_weight ?? '—')} variant="calculated" />
              </div>
            )}
          </div>

          {/* ── Section 7: Line Items ── */}
          <div className="space-y-1">
            <SectionHeader
              title="Line Items"
              open={sectionsOpen.line_items}
              onToggle={() => toggleSection('line_items')}
              badge={`${formData.line_items.length} item${formData.line_items.length !== 1 ? 's' : ''} · 4 editable fields`}
            />
            {sectionsOpen.line_items && (
              <div className="px-1 pt-2 pb-3 space-y-4">
                {formData.line_items.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground py-4 text-center">No line items in this document.</p>
                ) : (
                  formData.line_items.map((item, idx) => (
                    <div
                      key={idx}
                      className="border rounded-lg overflow-hidden"
                      style={{ borderColor: 'hsl(var(--border))' }}
                    >
                      <div className="px-3 py-2 bg-muted/30 flex items-center justify-between">
                        <span className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                          Line Item {idx + 1}
                        </span>
                        <span className="text-[12px] text-muted-foreground font-mono">{item.hsn_code}</span>
                      </div>
                      <div className="p-3 space-y-3">
                        {/* Description block — full width */}
                        <div className="border-b pb-2">
                          <div className="text-[12px] font-bold text-muted-foreground mb-1">
                            Description, Marks &amp; Nos., CONTAINER NO / SEAL NO, HS Code, Product Code
                          </div>
                          <ReadonlyField
                            label=""
                            value={`${item.product_description || ''} ${item.product_specification ? '- ' + item.product_specification : ''}`}
                            variant="si"
                          />
                          <div className="grid grid-cols-3 gap-2 mt-1">
                            <ReadonlyField label="Container/Marks" value={item.container_no || item.product_sku || '—'} variant="si" />
                            <ReadonlyField label="HS Code" value={item.hsn_code} variant="si" />
                            <ReadonlyField label="Product Code" value={item.product_code} variant="si" />
                          </div>
                        </div>

                        {/* Editable fields — 2 columns */}
                        <div className="grid grid-cols-2 gap-2.5">
                          <EditableField
                            label="QTY PER BNDL"
                            value={item.qty_per_bundle}
                            onChange={v => updateLineItem(idx, 'qty_per_bundle', v)}
                            type="number"
                            placeholder="0"
                          />
                          <EditableField
                            label="No. of BNDL (Pkgs Bundles)"
                            value={item.no_of_bundles}
                            onChange={v => updateLineItem(idx, 'no_of_bundles', v)}
                            type="number"
                            placeholder="0"
                          />
                        </div>

                        {/* Calculated + Editable weights */}
                        <div className="grid grid-cols-3 gap-2.5">
                          <ReadonlyField
                            label="TOTAL QTY IN PCS"
                            variant="calculated"
                            value={
                              (Number(item.qty_per_bundle) || 0) * (Number(item.no_of_bundles) || 0) || '—'
                            }
                          />
                          <EditableField
                            label="NET WEIGHT IN KGS"
                            value={item.net_weight_total}
                            onChange={v => updateLineItem(idx, 'net_weight_total', v)}
                            type="number"
                            placeholder="0.00"
                          />
                          <EditableField
                            label="GROSS WEIGHT IN KGS"
                            value={item.gross_weight_total}
                            onChange={v => updateLineItem(idx, 'gross_weight_total', v)}
                            type="number"
                            placeholder="0.00"
                          />
                        </div>

                        {/* Package Type — user input (rose border) */}
                        <div className="flex flex-col gap-0.5 w-1/3">
                          <label className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                            Package Type
                          </label>
                          <select
                            value={item.package_type}
                            onChange={e => updateLineItem(idx, 'package_type', e.target.value)}
                            className="w-full px-2.5 py-1.5 text-[14.5px] text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 rounded-md border-2 border-rose-300 dark:border-rose-500/30 min-h-[32px] cursor-pointer hover:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-500 dark:focus:ring-rose-400/50 transition-colors"
                          >
                            {PACKAGE_TYPES.map(pt => (
                              <option key={pt} value={pt}>{pt}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer buttons */}
        <div
          className="flex-shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t bg-background"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <button
            type="button"
            onClick={handleCancel}
            className="text-[14.5px] text-muted-foreground hover:text-foreground transition-colors px-2"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              className="px-4 py-2 text-[13px] font-semibold rounded-lg border bg-background hover:bg-muted transition-colors"
              style={{ borderColor: 'hsl(var(--border))' }}
            >
              Save Draft
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="px-4 py-2 text-[13px] font-semibold rounded-lg text-white transition-colors hover:opacity-90"
              style={{ background: 'hsl(var(--vs-teal, 173 58% 39%))' }}
            >
              Submit Packing List
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
