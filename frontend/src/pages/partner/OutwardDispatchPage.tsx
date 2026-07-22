import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, Loader2, Package, Plus, Send, Truck } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { getAuthToken } from '@/lib/api';
import { BACKEND_API_BASE as API_BASE } from '@/lib/apiBase';
import { toast } from 'sonner';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtAvailable(value: number) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

async function readApiJson(response: Response) {
  const text = await response.text();
  let payload: any = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { ok: false, error: text };
    }
  }
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

type StockRow = {
  id: string;
  productCode: string;
  description: string | null;
  hsCode: string | null;
  quantityOnHand: number;
  reservedQuantity: number;
  availableQuantity: number;
  netWeightKg: number;
  warehouse?: { id: string; name: string };
};

type DispatchLine = {
  warehouseStockId: string;
  productCode: string;
  description: string;
  availableQty: number;
  netWeightPerUnit: number;
  quantityDispatched: string;
  netWeightKg: string;
};

type OutwardRecord = {
  id: string;
  status: 'DRAFT' | 'CONFIRMED' | 'DISPATCHED';
};

function StockPickerRow({
  row,
  selected,
  line,
  onToggle,
  onQtyChange,
}: {
  row: StockRow;
  selected: boolean;
  line: DispatchLine | undefined;
  onToggle: () => void;
  onQtyChange: (qty: string) => void;
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
          <div className="shrink-0">
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
  onClose,
  onCreated,
}: {
  stock: StockRow[];
  stockLoading: boolean;
  onClose: () => void;
  onCreated: (record: OutwardRecord) => void;
}) {
  const [destinationName, setDestinationName] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [truckNumber, setTruckNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DispatchLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function toggleStock(row: StockRow) {
    setLines((prev) => {
      const exists = prev.find((line) => line.productCode === row.productCode);
      if (exists) return prev.filter((line) => line.productCode !== row.productCode);
      const skuRows = stock.filter((item) => item.productCode === row.productCode);
      const totalAvailable = skuRows.reduce((sum, item) => sum + Number(item.availableQuantity || 0), 0);
      const totalOnHand = skuRows.reduce((sum, item) => sum + Number(item.quantityOnHand || 0), 0);
      const totalNetWeight = skuRows.reduce((sum, item) => sum + Number(item.netWeightKg || 0), 0);
      return [
        ...prev,
        {
          warehouseStockId: row.id,
          productCode: row.productCode,
          description: row.description || '',
          availableQty: totalAvailable,
          netWeightPerUnit: totalOnHand > 0 ? totalNetWeight / totalOnHand : 0,
          quantityDispatched: '',
          netWeightKg: '',
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

    setSubmitting(true);
    try {
      const warehouseId = stock.find((row) => row.warehouse?.id)?.warehouse?.id ?? 'all';
      const payload = {
        warehouseId,
        destinationName: destinationName.trim(),
        destinationAddress: destinationAddress.trim() || undefined,
        truckNumber: truckNumber.trim() || undefined,
        driverName: driverName.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((line) => ({
          warehouseStockId: line.warehouseStockId,
          quantityDispatched: Number(line.quantityDispatched),
          netWeightKg: Number(line.netWeightKg) || undefined,
        })),
      };

      const res = await fetch(`${API_BASE}/api/warehouse/outward`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await readApiJson(res);
      if (!data.ok) throw new Error(data.error || data.detail || 'Failed to create draft GRN');
      setDestinationName('');
      setDestinationAddress('');
      setTruckNumber('');
      setDriverName('');
      setNotes('');
      setLines([]);
      onCreated(data.data);
    } catch (err: any) {
      setError(err.message || 'Failed to create draft GRN');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-[14.5px] font-semibold text-foreground">New Outward Dispatch</h2>
            <p className="text-[13px] text-muted-foreground">Create a draft GRN for warehouse outward</p>
          </div>
        </div>

        <div className="p-5 space-y-5">
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
              <div className="grid grid-cols-2 gap-3">
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
            ) : stock.length === 0 ? (
              <div className="rounded-lg border border-border p-6 text-center">
                <Package className="w-6 h-6 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-[13px] text-muted-foreground">No stock available to dispatch</p>
              </div>
            ) : (
              <div className="space-y-2">
                {stock
                  .filter((row) => row.availableQuantity > 0)
                  .filter((row, index, allRows) => allRows.findIndex((item) => item.productCode === row.productCode) === index)
                  .map((row) => {
                  const line = lines.find((item) => item.productCode === row.productCode);
                  return (
                    <StockPickerRow
                      key={row.id}
                      row={row}
                      selected={!!line}
                      line={line}
                      onToggle={() => toggleStock(row)}
                      onQtyChange={(qty) => setQty(row.productCode, qty)}
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

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border bg-muted/20">
          <button onClick={onClose} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={submitting || lines.length === 0} className="flex items-center gap-1.5 px-4 py-2 text-[14.5px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors">
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {submitting ? 'Creating...' : 'Create Draft GRN'}
          </button>
        </div>
    </div>
  );
}

export default function OutwardDispatchPage() {
  const [location, navigate] = useLocation();
  const fromDocGeneration = location.startsWith('/documents/generate');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);

  const fetchStock = useCallback(() => {
    setStockLoading(true);
    fetch(`${API_BASE}/api/warehouse/stock?page=1&pageSize=500`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await readApiJson(res);
        if (data.ok) setStock(data.data ?? []);
      })
      .catch(() => {})
      .finally(() => setStockLoading(false));
  }, []);

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  const backHref = fromDocGeneration ? '/documents/generate' : '/inventory/warehouse';
  const crumbRoot = fromDocGeneration ? 'Documents' : 'Warehouse';
  const crumbRootHref = fromDocGeneration ? '/documents/generate' : '/inventory/warehouse';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {fromDocGeneration && (
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div>
            <h1 className="text-[15px] font-semibold text-foreground">Document Generation</h1>
            <p className="text-[12px] text-muted-foreground">AI-drafted documents for review & approval</p>
          </div>
          <div className="flex items-center gap-1 ml-4 p-1 rounded-lg bg-muted/60">
            {[
              { type: 'packing-list', label: 'Packing List' },
              { type: 'outward-pl', label: 'Outward GRN' },
              { type: 'draft-boe', label: 'Draft CBP FORM 7501' },
            ].map((option) => {
              const active = option.type === 'outward-pl';
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
            Create a draft outward GRN from approved Packing List warehouse stock.
          </p>
        </div>
      </div>

      <NewDispatchForm
        stock={stock}
        stockLoading={stockLoading}
        onClose={() => navigate(backHref)}
        onCreated={() => {
          toast.success('Draft Outward GRN created');
          fetchStock();
          if (!fromDocGeneration) navigate('/inventory/warehouse');
        }}
      />
    </div>
  );
}
