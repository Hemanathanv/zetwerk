import { useState, useEffect, useCallback } from 'react';
import {
  Send, Plus, X, Check, Loader2, ChevronDown, ChevronUp,
  AlertCircle, Truck, Package, CheckCircle2, FileText,
  ArrowLeft, Lock,
} from 'lucide-react';
import { Link } from 'wouter';
import { getAuthToken } from '@/lib/api';
import { useDocTypePermissions, usePermissions } from '@/contexts/PermissionContext';

const API_BASE = ((import.meta.env.VITE_BACKEND_API_BASE as string | undefined) ?? '').replace(/\/$/, '');

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Types ────────────────────────────────────────────────────────────────────

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
  destinationName: string | null;
  destinationAddress: string | null;
  truckNumber: string | null;
  driverName: string | null;
  notes: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  documentId: string | null;
  lines: {
    id: string;
    quantityDispatched: number;
    netWeightKg: number;
    warehouseStock?: { productCode: string; description: string };
  }[];
};

// ─── Status badge ─────────────────────────────────────────────────────────────

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

// ─── Product picker row ────────────────────────────────────────────────────────

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
  const qtyInvalid = selected && (isNaN(qty) || qty <= 0 || qty > row.availableQuantity);

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
            Available: <span className="font-semibold text-teal-600">{row.availableQuantity}</span>
            {row.reservedQuantity > 0 && (
              <span className="text-amber-600 ml-2">({row.reservedQuantity} reserved)</span>
            )}
          </p>
        </div>
        {selected && (
          <div className="shrink-0 flex items-center gap-2">
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">Qty</label>
              <input
                type="number"
                min="1"
                max={row.availableQuantity}
                value={line?.quantityDispatched ?? ''}
                onChange={(e) => onQtyChange(e.target.value)}
                placeholder="0"
                className={`w-20 text-[13px] border rounded-lg px-2 py-1.5 bg-background text-foreground text-center ${qtyInvalid ? 'border-red-400' : 'border-border'}`}
              />
            </div>
          </div>
        )}
      </div>
      {qtyInvalid && (
        <p className="text-[12px] text-red-500 mt-1 ml-11">
          {qty > row.availableQuantity
            ? `Max available: ${row.availableQuantity}`
            : 'Enter a valid quantity'}
        </p>
      )}
    </div>
  );
}

// ─── New Dispatch Form (slide-over panel) ─────────────────────────────────────

function NewDispatchForm({
  stock,
  stockLoading,
  onClose,
  onCreated,
}: {
  stock: StockRow[];
  stockLoading: boolean;
  onClose: () => void;
  onCreated: () => void;
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
      const exists = prev.find((l) => l.warehouseStockId === row.id);
      if (exists) return prev.filter((l) => l.warehouseStockId !== row.id);
      return [
        ...prev,
        {
          warehouseStockId: row.id,
          productCode: row.productCode,
          description: row.description || '',
          availableQty: row.availableQuantity,
          netWeightPerUnit: row.availableQuantity > 0 ? row.netWeightKg / row.quantityOnHand : 0,
          quantityDispatched: '',
          netWeightKg: '',
        },
      ];
    });
  }

  function setQty(stockId: string, qty: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.warehouseStockId !== stockId) return l;
        const numQty = Number(qty);
        const estWeight = !isNaN(numQty) && numQty > 0 && l.netWeightPerUnit > 0
          ? (numQty * l.netWeightPerUnit).toFixed(2)
          : l.netWeightKg;
        return { ...l, quantityDispatched: qty, netWeightKg: estWeight };
      })
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
    for (const l of lines) {
      const qty = Number(l.quantityDispatched);
      if (isNaN(qty) || qty <= 0 || qty > l.availableQty) {
        setError(`Invalid quantity for ${l.productCode}. Must be between 1 and ${l.availableQty}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      // Resolve warehouseId from the already-loaded stock data
      const warehouseId = stock.find((s) => s.warehouse?.id)?.warehouse?.id;
      if (!warehouseId) throw new Error('Could not determine warehouse — no stock loaded');

      const payload = {
        warehouseId,
        destinationName: destinationName.trim(),
        destinationAddress: destinationAddress.trim() || undefined,
        truckNumber: truckNumber.trim() || undefined,
        driverName: driverName.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          warehouseStockId: l.warehouseStockId,
          quantityDispatched: Number(l.quantityDispatched),
          netWeightKg: Number(l.netWeightKg) || undefined,
        })),
      };

      const res = await fetch(`${API_BASE}/api/warehouse/outward`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || 'Failed to create dispatch');

      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to create dispatch');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto h-full w-full max-w-xl bg-background shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-[14.5px] font-semibold text-foreground">New Outward Dispatch</h2>
            <p className="text-[13px] text-muted-foreground">Create a draft GRN for warehouse outward</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Destination section */}
          <section>
            <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5" /> Destination & Vehicle
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">
                  Destination Name <span className="text-red-400">*</span>
                </label>
                <input
                  value={destinationName}
                  onChange={(e) => setDestinationName(e.target.value)}
                  placeholder="e.g. Chicago Steel Fabricators"
                  className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">
                  Destination Address
                </label>
                <textarea
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)}
                  placeholder="Street, City, State, ZIP"
                  rows={2}
                  className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-1">Truck / Vehicle No.</label>
                  <input
                    value={truckNumber}
                    onChange={(e) => setTruckNumber(e.target.value)}
                    placeholder="e.g. TRK-2024-LA01"
                    className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-1">Driver Name</label>
                  <input
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    placeholder="e.g. John Smith"
                    className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional dispatch notes…"
                  rows={2}
                  className="w-full text-[13px] border border-border rounded-lg px-3 py-2 bg-background text-foreground resize-none"
                />
              </div>
            </div>
          </section>

          {/* Product picker */}
          <section>
            <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" /> Select Products to Dispatch
            </h3>
            {stockLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 rounded-lg bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : stock.length === 0 ? (
              <div className="rounded-lg border border-border p-6 text-center">
                <Package className="w-6 h-6 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-[13px] text-muted-foreground">No stock available to dispatch</p>
              </div>
            ) : (
              <div className="space-y-2">
                {stock.filter((s) => s.availableQuantity > 0).map((row) => {
                  const line = lines.find((l) => l.warehouseStockId === row.id);
                  return (
                    <StockPickerRow
                      key={row.id}
                      row={row}
                      selected={!!line}
                      line={line}
                      onToggle={() => toggleStock(row)}
                      onQtyChange={(qty) => setQty(row.id, qty)}
                    />
                  );
                })}
                {stock.filter((s) => s.availableQuantity <= 0).length > 0 && (
                  <p className="text-[12px] text-muted-foreground text-center pt-1">
                    {stock.filter((s) => s.availableQuantity <= 0).length} item(s) fully reserved — not shown
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Selected summary */}
          {lines.length > 0 && (
            <div className="rounded-lg bg-teal-50/50 dark:bg-teal-950/10 border border-teal-200 dark:border-teal-800 p-3">
              <p className="text-[13px] font-semibold text-teal-700 dark:text-teal-400 mb-1">
                Dispatch Summary — {lines.length} line{lines.length !== 1 ? 's' : ''}
              </p>
              {lines.map((l) => (
                <div key={l.warehouseStockId} className="flex items-center justify-between text-[13px] text-muted-foreground py-0.5">
                  <span className="font-mono">{l.productCode}</span>
                  <span className="font-semibold text-foreground">
                    {l.quantityDispatched || '—'} units
                    {l.netWeightKg ? ` · ${Number(l.netWeightKg).toFixed(1)} kg` : ''}
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

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0 bg-muted/20">
          <button
            onClick={onClose}
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || lines.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-[14.5px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {submitting ? 'Creating…' : 'Create Draft GRN'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Outward Record Card ───────────────────────────────────────────────────────

function OutwardRecordCard({
  record,
  onConfirm,
  confirming,
}: {
  record: OutwardRecord;
  onConfirm: (id: string) => void;
  confirming: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const isConfirming = confirming === record.id;

  return (
    <div className={`bg-card rounded-xl border transition-colors ${record.status === 'DRAFT' ? 'border-amber-200 dark:border-amber-800' : 'border-border'}`}>
      {/* Card header */}
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
            {record.truckNumber && <span className="mr-2">🚛 {record.truckNumber}</span>}
            {record.driverName && <span className="mr-2">{record.driverName}</span>}
            <span>{fmtDate(record.createdAt)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {record.status === 'DRAFT' && (
            <button
              onClick={() => onConfirm(record.id)}
              disabled={isConfirming}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {isConfirming
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Check className="w-3 h-3" />}
              {isConfirming ? 'Confirming…' : 'Confirm & Generate GRN'}
            </button>
          )}
          {record.documentId && (
            <Link href={`/documents/${record.documentId}`}>
              <button className="flex items-center gap-1 px-2.5 py-1.5 text-[13px] rounded-lg border border-border hover:bg-muted text-muted-foreground transition-colors">
                <FileText className="w-3 h-3" /> GRN Doc
              </button>
            </Link>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded lines */}
      {expanded && (
        <div className="border-t border-border px-4 py-3">
          <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Dispatch Lines ({record.lines.length})
          </p>
          {record.lines.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No lines</p>
          ) : (
            <div className="space-y-1">
              {record.lines.map((line) => (
                <div key={line.id} className="flex items-center justify-between text-[13px] py-1 border-b border-border/40 last:border-0">
                  <div>
                    <span className="font-mono font-medium text-foreground">
                      {line.warehouseStock?.productCode || 'Unknown'}
                    </span>
                    {line.warehouseStock?.description && (
                      <span className="text-muted-foreground ml-2">{line.warehouseStock.description}</span>
                    )}
                  </div>
                  <div className="text-right text-muted-foreground">
                    <span className="font-semibold text-foreground">{line.quantityDispatched} units</span>
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

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function OutwardDispatchPage() {
  const { loaded: permLoaded } = usePermissions();
  const { canDo } = useDocTypePermissions();
  const canViewOutward   = canDo('OUTWARD_GRN', 'view');
  const canCreateOutward = canDo('OUTWARD_GRN', 'upload');

  const [records, setRecords] = useState<OutwardRecord[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stockLoading, setStockLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  const fetchRecords = useCallback(() => {
    setLoading(true);
    setError('');
    const params = filterStatus !== 'ALL' ? `?status=${filterStatus}` : '';
    fetch(`${API_BASE}/api/warehouse/outward${params}`, { headers: authHeaders() })
      .then(async (r) => {
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Failed to load');
        setRecords(d.data ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filterStatus]);

  const fetchStock = useCallback(() => {
    setStockLoading(true);
    fetch(`${API_BASE}/api/warehouse/stock`, { headers: authHeaders() })
      .then(async (r) => {
        const d = await r.json();
        if (d.ok) setStock(d.data ?? []);
      })
      .catch(() => {})
      .finally(() => setStockLoading(false));
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  function handleNewDispatch() {
    fetchStock();
    setShowForm(true);
  }

  async function handleConfirm(id: string) {
    setConfirmError('');
    setConfirming(id);
    try {
      const res = await fetch(`${API_BASE}/api/warehouse/outward/${id}/confirm`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || 'Confirm failed');
      fetchRecords();
    } catch (e: any) {
      setConfirmError(e.message || 'Confirm failed');
    } finally {
      setConfirming(null);
    }
  }

  if (permLoaded && !canViewOutward) {
    return (
      <div className="p-6 max-w-4xl mx-auto flex flex-col items-center justify-center gap-3 min-h-64">
        <Lock className="w-7 h-7 text-destructive" />
        <p className="text-[14.5px] font-semibold text-foreground">Access Restricted</p>
        <p className="text-[13px] text-muted-foreground text-center max-w-xs">
          Your role does not have permission to view outward dispatch records.
        </p>
      </div>
    );
  }

  const drafts = records.filter((r) => r.status === 'DRAFT');
  const others = records.filter((r) => r.status !== 'DRAFT');

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {showForm && (
        <NewDispatchForm
          stock={stock}
          stockLoading={stockLoading}
          onClose={() => setShowForm(false)}
          onCreated={fetchRecords}
        />
      )}

      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Link href="/partner/warehouse/stock">
              <button className="text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
            </Link>
            <h1 className="text-xl font-semibold text-foreground">Outward Dispatch</h1>
          </div>
          <p className="text-[14.5px] text-muted-foreground">
            Record and confirm outbound shipments from your warehouse
          </p>
        </div>
        {canCreateOutward && (
          <button
            onClick={handleNewDispatch}
            className="flex items-center gap-1.5 px-4 py-2 text-[14.5px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Dispatch
          </button>
        )}
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex gap-1 bg-muted/30 rounded-xl p-1 w-fit">
        {['ALL', 'DRAFT', 'CONFIRMED', 'DISPATCHED'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors ${
              filterStatus === s
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            {s === 'DRAFT' && drafts.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[12px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                {drafts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Confirm error ── */}
      {confirmError && (
        <div className="flex items-center gap-2 text-[14.5px] text-red-600 bg-red-50 dark:bg-red-950/20 rounded-lg px-4 py-3 border border-red-200 dark:border-red-900">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {confirmError}
          <button onClick={() => setConfirmError('')} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 text-[14.5px] text-red-600 bg-red-50 dark:bg-red-950/20 rounded-lg px-4 py-3 border border-red-200 dark:border-red-900">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && !error && records.length === 0 && (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <Send className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-[14.5px] font-medium text-foreground mb-1">No dispatch records yet</p>
          <p className="text-[13px] text-muted-foreground mb-4">
            {canCreateOutward
              ? "Create your first outward GRN when you're ready to dispatch stock."
              : "No outward dispatch records have been created yet."}
          </p>
          {canCreateOutward && (
            <button
              onClick={handleNewDispatch}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New Dispatch
            </button>
          )}
        </div>
      )}

      {/* ── Records ── */}
      {!loading && !error && records.length > 0 && (
        <div className="space-y-3">
          {drafts.length > 0 && (
            <>
              <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                Pending Confirmation ({drafts.length})
              </p>
              {drafts.map((r) => (
                <OutwardRecordCard key={r.id} record={r} onConfirm={handleConfirm} confirming={confirming} />
              ))}
            </>
          )}
          {others.length > 0 && (filterStatus === 'ALL' || filterStatus !== 'DRAFT') && (
            <>
              {drafts.length > 0 && <div className="h-px bg-border" />}
              <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal-500 inline-block" />
                Confirmed & Dispatched ({others.length})
              </p>
              {others.map((r) => (
                <OutwardRecordCard key={r.id} record={r} onConfirm={handleConfirm} confirming={confirming} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
