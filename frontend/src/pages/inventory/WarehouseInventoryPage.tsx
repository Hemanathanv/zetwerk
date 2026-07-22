import { useState, useEffect, useMemo } from 'react';
import { Link } from 'wouter';
import {
  Truck, ClipboardCheck, Package, Send, CheckCircle,
  AlertCircle, AlertTriangle, Search, RefreshCw, ShieldCheck,
  ChevronRight, Anchor, Settings, MapPin, Clock, X, List,
  ArrowRight,
} from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── SLA badge ───────────────────────────────────────────────
function SlaBadge({ status }: { status: 'ok' | 'warning' | 'overdue' }) {
  if (status === 'ok') return null;
  const cls = status === 'overdue'
    ? 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400'
    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400';
  return (
    <span className={`text-[12px] font-medium px-1.5 py-0.5 rounded-full ${cls}`}>
      SLA {status}
    </span>
  );
}

// ─── QC status badge ─────────────────────────────────────────
function QcBadge({ passed }: { passed: boolean | null }) {
  if (passed === null) return <span className="text-[12px] text-muted-foreground">No QC</span>;
  return passed
    ? <span className="flex items-center gap-1 text-[12px] text-teal-600 font-medium"><ShieldCheck className="w-3 h-3" /> QC Pass</span>
    : <span className="flex items-center gap-1 text-[12px] text-red-600 font-medium"><AlertCircle className="w-3 h-3" /> QC Fail</span>;
}

// ─── Stage badge ─────────────────────────────────────────────
function StageBadge({ stage }: { stage: string }) {
  const map: Record<string, string> = {
    inbound: 'bg-blue-100 text-blue-700',
    pending_qc: 'bg-amber-100 text-amber-700',
    in_stock: 'bg-teal-100 text-teal-700',
    dispatching: 'bg-indigo-100 text-indigo-700',
    delivered: 'bg-green-100 text-green-700',
  };
  const labels: Record<string, string> = {
    inbound: 'Inbound',
    pending_qc: 'Pending QC',
    in_stock: 'In Stock',
    dispatching: 'Dispatching',
    delivered: 'Delivered',
  };
  return (
    <span className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${map[stage] || 'bg-muted text-muted-foreground'}`}>
      {labels[stage] || stage}
    </span>
  );
}

// ─── Container row ───────────────────────────────────────────
function ContainerRow({ c }: { c: any }) {
  return (
    <Link href={`/inventory/containers/${c.id}`}>
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card hover:bg-muted/50 transition-colors cursor-pointer border border-transparent hover:border-border">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-semibold text-[14.5px]">{c.containerNumber}</span>
            <StageBadge stage={c.stage} />
            <SlaBadge status={c.slaStatus} />
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[13px] text-muted-foreground flex-wrap">
            {c.shipment?.shipmentNumber && (
              <span className="font-mono">{c.shipment.shipmentNumber}</span>
            )}
            {c.vesselName && <span>{c.vesselName}</span>}
            {c.containerSize && <span>{c.containerSize}</span>}
            {c.containerType && <span className="uppercase">{c.containerType}</span>}
          </div>
        </div>

        <div className="flex items-center gap-4 text-[13px] shrink-0">
          <div className="text-right hidden sm:block">
            {c.stage === 'delivered' && c.deliveredAt && (
              <div><span className="text-muted-foreground">Delivered</span> <span className="font-medium">{fmtDate(c.deliveredAt)}</span></div>
            )}
            {c.stage === 'dispatching' && c.dispatchedAt && (
              <div><span className="text-muted-foreground">Dispatched</span> <span className="font-medium">{fmtDate(c.dispatchedAt)}</span></div>
            )}
            {c.stage === 'in_stock' && c.inwardAt && (
              <div>
                <span className="text-muted-foreground">In stock since</span>{' '}
                <span className="font-medium">{fmtDate(c.inwardAt)}</span>
                {c.daysInStock != null && (
                  <span className="text-muted-foreground ml-1">({c.daysInStock}d)</span>
                )}
              </div>
            )}
            {c.stage === 'pending_qc' && (
              <div className="text-muted-foreground">Awaiting QC</div>
            )}
            {c.stage === 'inbound' && c.gateOutDate && (
              <div><span className="text-muted-foreground">Gate out</span> <span className="font-medium">{fmtDate(c.gateOutDate)}</span></div>
            )}
          </div>
          <QcBadge passed={c.qcPassed} />
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
    </Link>
  );
}

// ─── Port locations row ───────────────────────────────────────
function PortLocationsRow({ portWarehouses }: { portWarehouses: any[] }) {
  if (portWarehouses.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
        <Anchor className="w-3 h-3" /> Port / CFS Locations
      </div>
      <div className="flex flex-wrap gap-2">
        {portWarehouses.map((pw: any) => (
          <div key={pw.id} className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 text-[13px]">
            <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
            <div>
              <div className="font-semibold">{pw.name}</div>
              {(pw.portLocode || pw.port) && (
                <div className="text-[12px] text-muted-foreground font-mono">{pw.portLocode || pw.port}</div>
              )}
            </div>
            {pw.containersHeld > 0 && (
              <span className="ml-1 text-[12px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                {pw.containersHeld} held
              </span>
            )}
            {pw.slaHours && (
              <span className="flex items-center gap-0.5 text-[12px] text-muted-foreground">
                <Clock className="w-2.5 h-2.5" /> {pw.slaHours}h SLA
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SLA summary bar (click-to-filter) ───────────────────────
function SlaSummaryBar({ inventory, slaFilter, onFilter }: {
  inventory: any[];
  slaFilter: string;
  onFilter: (f: string) => void;
}) {
  const ok = inventory.filter(c => !c.slaStatus || c.slaStatus === 'ok').length;
  const warning = inventory.filter(c => c.slaStatus === 'warning').length;
  const overdue = inventory.filter(c => c.slaStatus === 'overdue').length;
  if (inventory.length === 0 || (warning === 0 && overdue === 0)) return null;

  const pill = (label: string, count: number, key: string, cls: string) => (
    <button
      onClick={() => onFilter(slaFilter === key ? 'all' : key)}
      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] transition-all ${
        slaFilter === key ? 'ring-2 ring-offset-1 font-semibold' : 'hover:opacity-80'
      } ${cls}`}
    >
      <span className="font-mono font-semibold">{count}</span> {label}
    </button>
  );

  return (
    <div className="flex items-center gap-3 mb-4 p-2.5 bg-muted/30 rounded-lg border border-border text-[13px]">
      <span className="text-muted-foreground font-medium">SLA Status:</span>
      {ok > 0 && pill('ok', ok, 'ok', 'text-teal-600 ring-teal-400')}
      {warning > 0 && pill('warning', warning, 'warning', 'text-amber-600 ring-amber-400')}
      {overdue > 0 && pill('overdue', overdue, 'overdue', 'text-red-600 ring-red-400')}
      {slaFilter !== 'all' && (
        <button onClick={() => onFilter('all')} className="ml-auto text-[12px] text-muted-foreground hover:text-foreground">
          Clear ×
        </button>
      )}
    </div>
  );
}

// ─── Movement type badge (warehouse page) ─────────────────────
const WAREHOUSE_MOVEMENT_META: Record<string, { label: string; direction: string; cls: string }> = {
  PORT_ARRIVAL:    { label: 'Arrived at Port',       direction: 'INWARD',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' },
  IN_TRANSIT:      { label: 'Gate Out / In Transit', direction: 'TRANSFER', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400' },
  THREE_PL_INWARD: { label: 'Received at 3PL',       direction: 'INWARD',   cls: 'bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400' },
  DISPATCHED:      { label: 'Dispatched',            direction: 'OUTWARD',  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400' },
  DELIVERED:       { label: 'Delivered',             direction: 'OUTWARD',  cls: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' },
};

const DIR_CLS: Record<string, string> = {
  INWARD:   'bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400',
  OUTWARD:  'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
  TRANSFER: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400',
};

function MovementChip({ type }: { type: string }) {
  const meta = WAREHOUSE_MOVEMENT_META[type] ?? { label: type.replace(/_/g, ' '), direction: 'TRANSFER', cls: 'bg-muted text-muted-foreground' };
  const dirCls = DIR_CLS[meta.direction] ?? 'bg-muted text-muted-foreground';
  return (
    <span className="flex items-center gap-1">
      <span className={`text-[8px] font-bold px-1 py-0.5 rounded tracking-wide ${dirCls}`}>
        {meta.direction === 'TRANSFER' ? 'XFER' : meta.direction}
      </span>
      <span className={`text-[13px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${meta.cls}`}>
        {meta.label}
      </span>
    </span>
  );
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── SKU movement drawer ──────────────────────────────────────
function SkuMovementDrawer({
  sku, warehouseId, onClose,
}: {
  sku: any;
  warehouseId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ grnReceipts: any[]; movements: any[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const url = `/api/inventory/warehouse/${warehouseId}/sku-movements?productCode=${encodeURIComponent(sku.productCode)}`;
    fetch(url, { headers: authHeaders() })
      .then(r => r.json())
      .then(res => setData(res.data ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [warehouseId, sku.productCode]);

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-background border-l border-border shadow-xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <List className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold text-[14.5px] font-mono">{sku.productCode}</span>
              {sku.s232 && (
                <span className="text-[13px] bg-orange-100 text-orange-700 px-1 py-0.5 rounded font-medium">232</span>
              )}
            </div>
            {sku.description && (
              <p className="text-[13px] text-muted-foreground mt-0.5">{sku.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-[14.5px]">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          ) : !data ? (
            <p className="text-[14.5px] text-muted-foreground text-center py-12">Failed to load movement history.</p>
          ) : (
            <>
              {/* Stock position */}
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Current Stock Position
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    ['On-Hand', (sku.totalQty ?? 0).toLocaleString()],
                    ['Reserved', (sku.reservedQty ?? 0) > 0 ? (sku.reservedQty).toLocaleString() : '—'],
                    ['Available', (sku.availableQty ?? sku.totalQty ?? 0).toLocaleString()],
                  ].map(([label, val]) => (
                    <div key={label} className="bg-muted/40 rounded-lg px-3 py-2 text-center">
                      <div className="text-[13px] text-muted-foreground font-medium uppercase tracking-wide">{label}</div>
                      <div className="text-[14.5px] font-bold font-mono mt-0.5">{val}</div>
                    </div>
                  ))}
                </div>
                {sku.hsCode && (
                  <p className="text-[13px] text-muted-foreground">HS Code: <span className="font-mono">{sku.hsCode}</span></p>
                )}
              </div>

              {/* GRN receipt history — one card per physical GRN receipt */}
              {data.grnReceipts.length > 0 && (
                <div>
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Receipt History ({data.grnReceipts.length} GRN{data.grnReceipts.length !== 1 ? 's' : ''})
                  </div>
                  <div className="space-y-2">
                    {data.grnReceipts.map((row: any, i: number) => (
                      <div key={i} className="bg-card border border-border rounded-lg px-3 py-2.5 text-[13px]">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-muted-foreground">{row.shipment_number || '—'}</span>
                            {row.container_number && (
                              <span className="font-mono text-[12px] text-muted-foreground">· {row.container_number}</span>
                            )}
                          </div>
                          <span className="text-muted-foreground text-[12px] shrink-0">{fmtDate(row.received_at)}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[12px] text-muted-foreground flex-wrap">
                          {row.received_qty != null && (
                            <span>Qty: <span className="font-mono font-semibold text-foreground">{Number(row.received_qty).toLocaleString()}</span></span>
                          )}
                          {row.received_weight_kg > 0 && (
                            <span>Weight: <span className="font-mono font-semibold text-foreground">{Number(row.received_weight_kg).toLocaleString()} kg</span></span>
                          )}
                          {row.received_by_name && (
                            <span>By: <span className="font-medium text-foreground">{row.received_by_name}</span></span>
                          )}
                          {row.exporter_name && (
                            <span className="truncate">{row.exporter_name}</span>
                          )}
                        </div>
                        {row.qc_overall_status && (
                          <div className={`mt-1 text-[13px] font-semibold inline-block px-1.5 py-0.5 rounded ${
                            row.qc_overall_status === 'PASSED'
                              ? 'bg-teal-100 text-teal-700'
                              : row.qc_overall_status === 'FAILED'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            QC {row.qc_overall_status}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {data.grnReceipts.length === 0 && data.movements.length === 0 && (
                <p className="text-[13px] text-muted-foreground text-center py-8">
                  No GRN receipts or inventory movements recorded for this SKU yet.
                </p>
              )}

              {/* Full movement ledger for associated shipments */}
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Inventory Movements ({data.movements.length})
                </div>
                {data.movements.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground py-4 text-center">No inventory movements recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {data.movements.map((mv: any, i: number) => {
                      const fromName = mv.from_warehouse_name ?? mv.from_port_name ?? '';
                      const toName = mv.to_warehouse_name ?? mv.to_port_name ?? '';
                      const type = mv.movement_type ?? '';
                      const movedAt = mv.moved_at ?? mv.movedAt;
                      const notes = mv.notes ?? '';
                      const containerNo = mv.container_number ?? '';
                      return (
                        <div key={i} className="bg-card border border-border rounded-lg px-3 py-2.5 text-[13px]">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <MovementChip type={type} />
                            <span className="text-[12px] text-muted-foreground shrink-0">{fmtDateTime(movedAt)}</span>
                          </div>
                          {(fromName || toName) && (
                            <div className="flex items-center gap-1 text-[12px] text-muted-foreground mb-1">
                              {fromName && <span>{fromName}</span>}
                              {fromName && toName && <ArrowRight className="w-3 h-3 shrink-0" />}
                              {toName && <span className="font-medium text-foreground">{toName}</span>}
                            </div>
                          )}
                          <div className="flex items-center gap-3 text-[12px] text-muted-foreground mt-1 flex-wrap">
                            {containerNo && (
                              <span className="font-mono">{containerNo}</span>
                            )}
                            {mv.quantity != null && (
                              <span>Qty: <span className="font-mono font-semibold text-foreground">{Number(mv.quantity).toLocaleString()}</span></span>
                            )}
                            {mv.weight_kg != null && (
                              <span>Weight: <span className="font-mono font-semibold text-foreground">{Number(mv.weight_kg).toLocaleString()} kg</span></span>
                            )}
                            {mv.performed_by_name && (
                              <span>By: <span className="font-medium text-foreground">{mv.performed_by_name}</span></span>
                            )}
                          </div>
                          {notes && (
                            <p className="text-[12px] text-muted-foreground mt-1 italic">{notes}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── SKU view ────────────────────────────────────────────────
function SkuView({ skuSummary, warehouseId }: { skuSummary: any[]; warehouseId: string | null }) {
  const [search, setSearch] = useState('');
  const [selectedSku, setSelectedSku] = useState<any | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return skuSummary;
    const q = search.toLowerCase();
    return skuSummary.filter(
      (s) =>
        s.productCode.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.hsCode?.toLowerCase().includes(q)
    );
  }, [skuSummary, search]);

  if (skuSummary.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground text-[14.5px]">
        No stock position rows found from Packing List or generated Packing List sources.
      </div>
    );
  }

  const totalQty = skuSummary.reduce((s, r) => s + (r.totalQty ?? 0), 0);
  const totalWeight = skuSummary.reduce((s, r) => s + (r.totalWeight ?? 0), 0);
  const totalAvailable = skuSummary.reduce((s, r) => s + (r.availableQty ?? r.totalQty ?? 0), 0);

  return (
    <div>
      {selectedSku && warehouseId && (
        <SkuMovementDrawer
          sku={selectedSku}
          warehouseId={warehouseId}
          onClose={() => setSelectedSku(null)}
        />
      )}

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <p className="text-[13px] text-muted-foreground">
            {skuSummary.length} product{skuSummary.length !== 1 ? 's' : ''} ·{' '}
            {totalQty.toLocaleString()} on-hand ·{' '}
            {totalAvailable.toLocaleString()} available ·{' '}
            {totalWeight.toLocaleString()} kg
          </p>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKUs…"
            className="pl-8 pr-3 py-1.5 text-[13px] border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-teal-500 w-48"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-muted/50 border-b text-muted-foreground">
              <th className="text-left py-2.5 px-4 font-medium">Product</th>
              <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell">Description</th>
              <th className="text-right py-2.5 px-3 font-medium">On-Hand</th>
              <th className="text-right py-2.5 px-3 font-medium hidden sm:table-cell">Reserved</th>
              <th className="text-right py-2.5 px-3 font-medium hidden md:table-cell">Available</th>
              <th className="text-right py-2.5 px-3 font-medium hidden md:table-cell">Weight</th>
              <th className="text-left py-2.5 px-3 font-medium hidden lg:table-cell">HS Code</th>
              <th className="text-left py-2.5 px-3 font-medium hidden lg:table-cell">Source</th>
              <th className="py-2.5 px-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((sku, idx) => {
              const onHand    = sku.totalQty ?? 0;
              const reserved  = sku.reservedQty ?? 0;
              const available = sku.availableQty ?? (onHand - reserved);
              const isGrn     = sku.dataSource === 'grn';
              return (
              <tr
                key={idx}
                className="border-b border-muted/20 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => setSelectedSku(sku)}
              >
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold">{sku.productCode}</span>
                    {sku.s232 && (
                      <span className="text-[13px] bg-orange-100 text-orange-700 px-1 py-0.5 rounded font-medium">232</span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-3 text-muted-foreground max-w-[200px] truncate hidden sm:table-cell">
                  {sku.description || '—'}
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-medium">
                  {onHand.toLocaleString()}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-muted-foreground hidden sm:table-cell">
                  {reserved > 0 ? reserved.toLocaleString() : '—'}
                </td>
                <td className="py-2.5 px-3 text-right font-mono hidden md:table-cell">
                  <span className={available < onHand ? 'text-amber-600 font-medium' : 'text-teal-600 font-medium'}>
                    {available.toLocaleString()}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-muted-foreground hidden md:table-cell">
                  {sku.totalWeight > 0 ? `${sku.totalWeight.toLocaleString()} kg` : '—'}
                </td>
                <td className="py-2.5 px-3 font-mono text-muted-foreground hidden lg:table-cell">
                  {sku.hsCode || '—'}
                </td>
                <td className="py-2.5 px-3 hidden lg:table-cell">
                  <span className={`text-[13px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5 w-fit ${
                    isGrn
                      ? 'bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                  }`}>
                    <ShieldCheck className="w-2.5 h-2.5" />
                    {isGrn ? 'GRN' : 'Est.'}
                  </span>
                </td>
                <td className="py-2.5 px-3">
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
                </td>
              </tr>
            );})}

          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center py-8 text-[13px] text-muted-foreground">No products match "{search}"</p>
        )}
      </div>
      <p className="text-[12px] text-muted-foreground mt-2 text-center">
        Click a row to view movement history for that SKU
      </p>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────
type StockPositionRow = {
  id: string;
  productCode: string;
  description: string | null;
  hsCode: string | null;
  quantityOnHand: number;
  reservedQuantity: number;
  availableQuantity: number;
  netWeightKg: number;
  receivedAt: string | null;
};

type StockPaginationMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  totalAvailable: number;
  totalReserved: number;
};

function fmtStockNum(value: number | null | undefined, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: decimals });
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

function StockAvailability({ available, onHand }: { available: number; onHand: number }) {
  const pct = onHand > 0 ? Math.max(0, Math.min(100, (available / onHand) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="h-1.5 w-14 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[12px] text-muted-foreground">{Math.round(pct)}%</span>
    </div>
  );
}

function WarehouseStockPositionScreen() {
  const [rows, setRows] = useState<StockPositionRow[]>([]);
  const [meta, setMeta] = useState<StockPaginationMeta>({
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    totalAvailable: 0,
    totalReserved: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (search.trim()) params.set('search', search.trim());
    fetch(`/api/warehouse/stock?${params.toString()}`, { headers: authHeaders() })
      .then(async (r) => {
        const payload = await readApiJson(r);
        if (!payload.ok) throw new Error(payload.error || 'Failed to load stock position');
        setRows(payload.data || []);
        setMeta({
          total: payload.meta?.total ?? 0,
          page: payload.meta?.page ?? page,
          pageSize: payload.meta?.pageSize ?? pageSize,
          totalPages: payload.meta?.totalPages ?? 1,
          totalAvailable: payload.meta?.totalAvailable ?? 0,
          totalReserved: payload.meta?.totalReserved ?? 0,
        });
      })
      .catch((err) => setError(err.message || 'Failed to load stock position'))
      .finally(() => setLoading(false));
  }, [page, pageSize, refreshKey, search]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  const firstShown = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const lastShown = Math.min(meta.total, (meta.page - 1) * meta.pageSize + rows.length);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="text-[13px] text-muted-foreground mb-6">
        <span>Warehouse</span>
        <span className="mx-2">›</span>
        <span className="font-medium text-foreground">Stock</span>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Stock Position</h1>
          <p className="text-[14.5px] text-muted-foreground mt-0.5">Current on-hand inventory at your warehouse</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/documents/generate/outward-pl">
            <button className="flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors font-medium">
              <ArrowRight className="w-3.5 h-3.5" />
              Outward Dispatch
            </button>
          </Link>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {[
          ['Total SKUs', meta.total.toLocaleString(), 'product lines on hand'],
          ['Available Units', fmtStockNum(meta.totalAvailable), 'free to dispatch'],
          ['Reserved Units', fmtStockNum(meta.totalReserved), 'in pending dispatches'],
        ].map(([label, value, sub]) => (
          <div key={label} className="bg-card rounded-xl border border-border p-4">
            <p className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
            <p className="text-2xl font-semibold text-foreground">{value}</p>
            <p className="text-[13px] text-muted-foreground mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by product code, description, or HS code..."
          className="w-full pl-9 pr-4 py-2 text-[14.5px] border border-border rounded-xl bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-[14.5px] text-red-600 bg-red-50 dark:bg-red-950/20 rounded-lg px-4 py-3 border border-red-200 dark:border-red-900 mb-5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />)}
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[14.5px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Product Code', 'Description', 'HS Code', 'On Hand', 'Reserved', 'Available', 'Net Wt (kg)', 'Availability', 'Received'].map(header => (
                    <th key={header} className="text-left text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3 whitespace-nowrap">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[14.5px] text-muted-foreground">
                      {search.trim() ? `No results matching "${search}".` : 'No approved Packing List stock lines found.'}
                    </td>
                  </tr>
                ) : rows.map(row => (
                  <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-[13px] text-foreground whitespace-nowrap">{row.productCode}</td>
                    <td className="px-4 py-3 text-[13px] text-foreground max-w-[260px] truncate">{row.description || '—'}</td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground font-mono whitespace-nowrap">{row.hsCode || '—'}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-foreground text-right whitespace-nowrap">{fmtStockNum(row.quantityOnHand)}</td>
                    <td className="px-4 py-3 text-[13px] text-amber-600 font-medium text-right whitespace-nowrap">{row.reservedQuantity > 0 ? fmtStockNum(row.reservedQuantity) : '—'}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-teal-600 text-right whitespace-nowrap">{fmtStockNum(row.availableQuantity)}</td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground text-right whitespace-nowrap">{fmtStockNum(row.netWeightKg, 2)}</td>
                    <td className="px-4 py-3"><StockAvailability available={row.availableQuantity} onHand={row.quantityOnHand} /></td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground whitespace-nowrap">{fmtDate(row.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-border bg-muted/10 text-[13px] text-muted-foreground flex items-center justify-between gap-3 flex-wrap">
            <span>
              Showing {firstShown}-{lastShown} of {meta.total} stock line{meta.total !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="h-8 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground"
              >
                {[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}/page</option>)}
              </select>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={loading || meta.page <= 1}
                className="h-8 px-3 rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-[13px] text-muted-foreground">
                Page {meta.page} of {meta.totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                disabled={loading || meta.page >= meta.totalPages}
                className="h-8 px-3 rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function WarehouseInventoryPage() {
  return <WarehouseStockPositionScreen />;
}

function LegacyWarehouseInventoryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role?.category === 'org_admin';

  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [portWarehouses, setPortWarehouses] = useState<any[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [inventory, setInventory] = useState<any[]>([]);
  const [skuSummary, setSkuSummary] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [warehouseLoading, setWarehouseLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'container' | 'sku'>('sku');
  const [stageFilter, setStageFilter] = useState('all');
  const [slaFilter, setSlaFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setWarehouseLoading(true);
    Promise.all([
      fetch('/api/inventory/warehouses', { headers: authHeaders() }).then(r => r.json()),
      fetch('/api/inventory/port-warehouses', { headers: authHeaders() }).then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([warehouseRes, portRes]) => {
      const whs = warehouseRes.data || [];
      setWarehouses(whs);
      setPortWarehouses(portRes.data || []);
      if (whs.length > 0) setSelectedWarehouseId(whs[0].id);
    }).finally(() => setWarehouseLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedWarehouseId) return;
    setLoading(true);
    fetch(`/api/warehouse/stock/sku-summary`, { headers: authHeaders() })
      .then((r) => r.json())
      .catch(() => ({ data: [] }))
      .then((skuRes) => {
      const skuRows: any[] = skuRes.data || [];
      setSkuSummary(skuRows.map((r: any) => ({
        productCode: r.productCode,
        description: r.description,
        hsCode: r.hsCode,
        totalQty: r.totalQuantityOnHand ?? 0,
        reservedQty: r.totalReservedQuantity ?? 0,
        availableQty: r.availableQuantity ?? 0,
        totalWeight: r.totalNetWeightKg ?? 0,
        shipments: r.shipmentCount ?? 0,
        dataSource: r.dataSource ?? null,
      })));
    }).finally(() => setLoading(false));
  }, [selectedWarehouseId]);

  const selectedWarehouse = warehouses.find((w) => w.id === selectedWarehouseId);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {
      inbound: 0, pending_qc: 0, in_stock: 0, dispatching: 0, delivered: 0,
    };
    for (const c of inventory) counts[c.stage] = (counts[c.stage] || 0) + 1;
    return counts;
  }, [inventory]);

  const stageConfig = [
    { key: 'inbound', label: 'Inbound', Icon: Truck, bg: 'bg-blue-50 dark:bg-blue-950/20', text: 'text-blue-700 dark:text-blue-400', ring: 'ring-blue-400' },
    { key: 'pending_qc', label: 'Pending QC', Icon: ClipboardCheck, bg: 'bg-amber-50 dark:bg-amber-950/20', text: 'text-amber-700 dark:text-amber-400', ring: 'ring-amber-400' },
    { key: 'in_stock', label: 'In Stock', Icon: Package, bg: 'bg-teal-50 dark:bg-teal-950/20', text: 'text-teal-700 dark:text-teal-400', ring: 'ring-teal-400' },
    { key: 'dispatching', label: 'Dispatching', Icon: Send, bg: 'bg-indigo-50 dark:bg-indigo-950/20', text: 'text-indigo-700 dark:text-indigo-400', ring: 'ring-indigo-400' },
    { key: 'delivered', label: 'Delivered', Icon: CheckCircle, bg: 'bg-green-50 dark:bg-green-950/20', text: 'text-green-700 dark:text-green-400', ring: 'ring-green-400' },
  ];

  const filteredInventory = useMemo(() => {
    let list = stageFilter === 'all' ? inventory : inventory.filter((c) => c.stage === stageFilter);
    if (slaFilter !== 'all') {
      if (slaFilter === 'ok') list = list.filter(c => !c.slaStatus || c.slaStatus === 'ok');
      else list = list.filter(c => c.slaStatus === slaFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.containerNumber?.toLowerCase().includes(q) ||
          c.shipment?.shipmentNumber?.toLowerCase().includes(q) ||
          c.vesselName?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [inventory, stageFilter, slaFilter, search]);

  if (warehouseLoading) {
    return (
      <div className="p-6 flex items-center justify-center text-muted-foreground text-[14.5px]">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading warehouses…
      </div>
    );
  }

  if (warehouses.length === 0) {
    return (
      <div className="p-6">
        <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', margin: '0 0 16px', lineHeight: 1.2 }}>Warehouse Inventory</h1>
        <div className="bg-card rounded-xl p-8 text-center">
          <Package className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-50" />
          <p className="text-[14.5px] font-medium mb-1">No warehouses configured</p>
          <p className="text-[13px] text-muted-foreground">
            {isAdmin ? (
              <>
                Add warehouses in{' '}
                <Link href="/settings" className="text-teal-600 hover:underline">
                  Settings → Organisations
                </Link>
                .
              </>
            ) : (
              'Contact your admin to set up a warehouse for your organisation.'
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>Stock Position</h1>
          <p className="text-[14.5px] text-muted-foreground mt-0.5">
            {selectedWarehouse ? selectedWarehouse.name : 'Select a warehouse'}
            {selectedWarehouse?.address && (
              <span className="ml-1">· {selectedWarehouse.address}</span>
            )}
            {selectedWarehouse?.firmsCode && (
              <span className="ml-1 font-mono">({selectedWarehouse.firmsCode})</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {warehouses.length > 1 && (
            <select
              value={selectedWarehouseId || ''}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="text-[14.5px] border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}

          {isAdmin && (
            <a
              href="/settings"
              title="Configure warehouse settings"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Settings className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>

      {/* Stage summary cards */}
      {viewMode === 'container' && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          {stageConfig.map(({ key, label, Icon, bg, text, ring }) => (
            <button
              key={key}
              onClick={() => setStageFilter(stageFilter === key ? 'all' : key)}
              className={`rounded-xl p-3 text-center transition-all ${bg} ${
                stageFilter === key ? `ring-2 ${ring}` : ''
              }`}
            >
              <Icon className={`w-5 h-5 mx-auto opacity-60 ${text}`} />
              <div className={`text-2xl font-bold font-mono mt-1 ${text}`}>
                {stageCounts[key] || 0}
              </div>
              <div className={`text-[12px] font-medium opacity-70 ${text}`}>{label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-[14.5px]">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading inventory…
        </div>
      ) : viewMode === 'sku' ? (
        <SkuView skuSummary={skuSummary} warehouseId={selectedWarehouseId} />
      ) : (
        <>
          {/* SLA summary bar — click pills to filter */}
          <SlaSummaryBar inventory={inventory} slaFilter={slaFilter} onFilter={setSlaFilter} />

          {/* Search + filter bar */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search containers…"
                className="pl-8 pr-3 py-1.5 text-[13px] border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-teal-500 w-full"
              />
            </div>
            {stageFilter !== 'all' && (
              <button
                onClick={() => setStageFilter('all')}
                className="text-[13px] text-teal-600 hover:underline"
              >
                Clear filter
              </button>
            )}
            <span className="text-[13px] text-muted-foreground ml-auto">
              {filteredInventory.length} container{filteredInventory.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Container list */}
          {filteredInventory.length === 0 ? (
            <div className="text-center py-16">
              {inventory.length === 0 ? (
                <>
                  <Package className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-40" />
                  <p className="text-[14.5px] text-muted-foreground">No containers found for this warehouse.</p>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    Containers appear here once they reach gate-out or in-warehouse status.
                  </p>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-8 h-8 mx-auto text-muted-foreground mb-3 opacity-40" />
                  <p className="text-[14.5px] text-muted-foreground">No containers match this filter.</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredInventory.map((c) => (
                <ContainerRow key={c.id} c={c} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
