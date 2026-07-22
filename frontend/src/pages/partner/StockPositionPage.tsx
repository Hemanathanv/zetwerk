import { useState, useEffect, useMemo } from 'react';
import {
  Package, Search, RefreshCw, Warehouse,
  AlertCircle, ArrowRight,
} from 'lucide-react';
import { Link } from 'wouter';
import { getAuthToken } from '@/lib/api';

const API_BASE = ((import.meta.env.VITE_BACKEND_API_BASE as string | undefined) ?? '').replace(/\/$/, '');

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtNum(n: number | null | undefined, decimals = 2) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
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
  grossWeightKg: number;
  originShipmentId: string | null;
  originGrnId: string | null;
  receivedAt: string | null;
  lastMovedAt: string | null;
  warehouse?: { id: string; name: string };
};

function AvailabilityBar({ available, onHand }: { available: number; onHand: number }) {
  const pct = onHand === 0 ? 0 : Math.max(0, (available / onHand) * 100);
  const color = pct < 20 ? 'bg-red-500' : pct < 50 ? 'bg-amber-400' : 'bg-teal-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden min-w-[40px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[12px] text-muted-foreground shrink-0">{Math.round(pct)}%</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-card rounded-xl border border-border p-12 text-center">
      <Warehouse className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
      <p className="text-[14.5px] font-medium text-foreground mb-1">No stock on hand</p>
      <p className="text-[13px] text-muted-foreground max-w-xs mx-auto">
        Once inward GRN records are completed and backfilled, your warehouse stock will appear here.
      </p>
    </div>
  );
}

export default function StockPositionPage() {
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`${API_BASE}/api/warehouse/stock`, { headers: authHeaders() })
      .then(async (r) => {
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Failed to load');
        setStock(d.data ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const filtered = useMemo(() => {
    if (!search.trim()) return stock;
    const q = search.toLowerCase();
    return stock.filter(
      (s) =>
        s.productCode.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.hsCode ?? '').toLowerCase().includes(q)
    );
  }, [stock, search]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Stock Position</h1>
          <p className="text-[14.5px] text-muted-foreground mt-0.5">
            Current on-hand inventory at your warehouse
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/documents/generate/outward-pl">
            <button className="flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors font-medium">
              <ArrowRight className="w-3.5 h-3.5" />
              Outward Dispatch
            </button>
          </Link>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Summary strip ── */}
      {!loading && stock.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: 'Total SKUs',
              value: stock.length,
              sub: 'product lines on hand',
            },
            {
              label: 'Available Units',
              value: fmtNum(stock.reduce((a, s) => a + s.availableQuantity, 0), 0),
              sub: 'free to dispatch',
            },
            {
              label: 'Reserved Units',
              value: fmtNum(stock.reduce((a, s) => a + s.reservedQuantity, 0), 0),
              sub: 'in pending dispatches',
            },
          ].map((card) => (
            <div key={card.label} className="bg-card rounded-xl border border-border p-4">
              <p className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                {card.label}
              </p>
              <p className="text-2xl font-semibold text-foreground">{card.value}</p>
              <p className="text-[13px] text-muted-foreground mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Search ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by product code, description, or HS code…"
          className="w-full pl-9 pr-4 py-2 text-[14.5px] border border-border rounded-xl bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        />
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 text-[14.5px] text-red-600 bg-red-50 dark:bg-red-950/20 rounded-lg px-4 py-3 border border-red-200 dark:border-red-900">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && !error && stock.length === 0 && <EmptyState />}

      {/* ── Table ── */}
      {!loading && !error && stock.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[14.5px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {[
                    'Product Code',
                    'Description',
                    'HS Code',
                    'On Hand',
                    'Reserved',
                    'Available',
                    'Net Wt (kg)',
                    'Availability',
                    'Received',
                    'Origin Shipment',
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left text-[13px] font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-[14.5px] text-muted-foreground">
                      No results matching &ldquo;{search}&rdquo;
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-[13px] text-foreground whitespace-nowrap">
                        {row.productCode}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-foreground max-w-[220px] truncate">
                        {row.description || '—'}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-muted-foreground font-mono">
                        {row.hsCode || '—'}
                      </td>
                      <td className="px-4 py-3 text-[13px] font-semibold text-foreground text-right whitespace-nowrap">
                        {fmtNum(row.quantityOnHand, 0)}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-amber-600 font-medium text-right whitespace-nowrap">
                        {row.reservedQuantity > 0 ? fmtNum(row.reservedQuantity, 0) : '—'}
                      </td>
                      <td className="px-4 py-3 text-[13px] font-semibold text-teal-600 text-right whitespace-nowrap">
                        {fmtNum(row.availableQuantity, 0)}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-muted-foreground text-right whitespace-nowrap">
                        {fmtNum(row.netWeightKg, 2)}
                      </td>
                      <td className="px-4 py-3 min-w-[100px]">
                        <AvailabilityBar
                          available={row.availableQuantity}
                          onHand={row.quantityOnHand}
                        />
                      </td>
                      <td className="px-4 py-3 text-[13px] text-muted-foreground whitespace-nowrap">
                        {fmtDate(row.receivedAt)}
                      </td>
                      <td className="px-4 py-3 text-[13px] font-mono text-muted-foreground whitespace-nowrap">
                        {row.originShipmentId
                          ? <Link href={`/shipments/${row.originShipmentId}`}>
                              <span className="text-teal-600 hover:underline cursor-pointer">
                                {row.originShipmentId.slice(-8).toUpperCase()}
                              </span>
                            </Link>
                          : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border bg-muted/10 text-[13px] text-muted-foreground">
              Showing {filtered.length} of {stock.length} stock line{stock.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
