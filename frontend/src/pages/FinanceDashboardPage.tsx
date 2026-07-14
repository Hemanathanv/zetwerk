import { useState, useEffect, useMemo } from 'react';
import { getAuthToken } from '@/lib/api';
import { AlertTriangle, Clock, Calendar, CheckCircle, BarChart3, TrendingUp, TrendingDown } from 'lucide-react';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Color helpers ────────────────────────────────────────────────────────────

const colorBg: Record<string, string> = {
  amber:  'bg-amber-50 text-amber-700',
  blue:   'bg-blue-50 text-blue-700',
  teal:   'bg-teal-50 text-teal-700',
  green:  'bg-green-50 text-green-700',
  red:    'bg-red-50 text-red-700',
};

const categoryColors: Record<number, string> = {
  0: 'bg-teal-500', 1: 'bg-blue-500', 2: 'bg-amber-500',
  3: 'bg-purple-500', 4: 'bg-red-500', 5: 'bg-indigo-500',
  6: 'bg-green-500', 7: 'bg-orange-500',
};

// ─── TAB 1: Overview ─────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: any }) {
  const statusMap = new Map((data.summary.statusCounts || []).map((s: any) => [s.status, s]));

  const cards = [
    { label: 'Pending',   value: (statusMap.get('pending')   as any)?._count?.id || 0, color: 'amber' },
    { label: 'In Review', value: (statusMap.get('in_review') as any)?._count?.id || 0, color: 'blue'  },
    { label: 'Approved',  value: (statusMap.get('approved')  as any)?._count?.id || 0, color: 'teal'  },
    { label: 'Posted',    value: (statusMap.get('posted')    as any)?._count?.id || 0, color: 'green' },
  ];

  const totalTickets = (data.summary.statusCounts || []).reduce((s: number, c: any) => s + (c._count?.id || 0), 0);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {cards.map(c => (
          <div key={c.label} className={`rounded-xl p-4 border ${colorBg[c.color]}`}>
            <div className="text-3xl font-bold font-mono">{c.value}</div>
            <div className="text-[12px] font-medium opacity-70 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {(data.summary.pendingByCurrency?.length > 0) && (
        <div className="bg-card rounded-xl p-5 mb-4 border">
          <h3 className="text-[15px] font-semibold mb-4">Pending Amount by Currency</h3>
          <div className="flex flex-wrap gap-6">
            {data.summary.pendingByCurrency.map((c: any) => (
              <div key={c.currency}>
                <div className="text-lg font-bold font-mono">
                  {c.currency} {Number(c._sum?.amount || 0).toLocaleString()}
                </div>
                <div className="text-[12px] text-muted-foreground mt-0.5">{c._count?.id} ticket{c._count?.id !== 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="bg-card rounded-xl p-5 border">
          <h3 className="text-[15px] font-semibold mb-4">Total Tickets</h3>
          <div className="text-3xl font-bold font-mono">{totalTickets}</div>
          <div className="text-[12px] text-muted-foreground mt-1">across all statuses</div>
        </div>
        <div className="bg-card rounded-xl p-5 border">
          <h3 className="text-[15px] font-semibold mb-4">Shipments with Costs</h3>
          <div className="text-3xl font-bold font-mono">{(data.shipmentCosts || []).filter((s: any) => s.totalCost > 0).length}</div>
          <div className="text-[12px] text-muted-foreground mt-1">of {(data.shipmentCosts || []).length} total</div>
        </div>
      </div>

      <div className="flex gap-3 text-[13px] mt-4">
        <a href="/accounting" className="text-[13px] text-teal-600 hover:underline">Open ticket queue →</a>
      </div>
    </div>
  );
}

// ─── TAB 2: Shipment Cost View ────────────────────────────────────────────────

function ShipmentCostTab({ data }: { data: any }) {
  const shipments: any[] = data.shipmentCosts || [];
  const [sortBy, setSortBy] = useState<'cost' | 'margin' | 'shipment'>('cost');

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const s of shipments) {
      for (const c of (s.costsByCategory || [])) cats.add(c.category);
    }
    return [...cats].sort();
  }, [shipments]);

  const sorted = useMemo(() => {
    const s = [...shipments];
    if (sortBy === 'cost')     return s.sort((a, b) => b.totalCost - a.totalCost);
    if (sortBy === 'margin')   return s.sort((a, b) => (a.marginPct ?? -999) - (b.marginPct ?? -999));
    if (sortBy === 'shipment') return s.sort((a, b) => (a.shipmentNumber || '').localeCompare(b.shipmentNumber || ''));
    return s;
  }, [shipments, sortBy]);

  if (shipments.length === 0) {
    return (
      <div className="bg-card rounded-xl p-8 text-center border">
        <BarChart3 className="w-8 h-8 mx-auto text-muted-foreground/30" />
        <p className="text-[14.5px] text-muted-foreground mt-3">No shipment cost data yet</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-semibold">{shipments.length} shipments with cost data</h3>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="text-[13px] border rounded-lg px-2 py-1.5 bg-background">
          <option value="cost">Highest cost</option>
          <option value="margin">Lowest margin</option>
          <option value="shipment">By shipment</option>
        </select>
      </div>

      <div className="bg-card rounded-xl overflow-hidden border">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/20">
                <th className="text-left py-3 px-5 font-medium sticky left-0 bg-muted/10 text-[12px]">Shipment</th>
                {allCategories.map(cat => (
                  <th key={cat} className="text-right py-3 px-5 font-medium whitespace-nowrap text-[12px]">{cat}</th>
                ))}
                <th className="text-right py-3 px-5 font-medium text-[12px]">Total Cost</th>
                <th className="text-right py-3 px-5 font-medium text-[12px]">Revenue</th>
                <th className="text-right py-3 px-5 font-medium text-[12px]">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s: any) => (
                <tr key={s.shipmentId} className="border-b border-muted/20 hover:bg-muted/10">
                  <td className="py-4 px-5">
                    <a href={`/shipments/${s.shipmentId}`} className="font-mono text-teal-600 hover:underline">
                      {s.shipmentNumber || 'Pending'}
                    </a>
                    {s.projectCode && <div className="text-[13px] text-muted-foreground">{s.projectCode}</div>}
                  </td>
                  {allCategories.map(cat => {
                    const cost = (s.costsByCategory || []).find((c: any) => c.category === cat);
                    return (
                      <td key={cat} className="text-right py-4 px-5 font-mono">
                        {cost ? (
                          <span title={`${cost.ticketCount} ticket(s) — ${cost.currency}`}>
                            {Number(cost.amount).toLocaleString()}
                          </span>
                        ) : <span className="text-muted-foreground/30">—</span>}
                      </td>
                    );
                  })}
                  <td className="text-right py-4 px-5 font-mono font-medium">
                    {Number(s.totalCost).toLocaleString()}
                  </td>
                  <td className="text-right py-4 px-5 font-mono text-muted-foreground">
                    {s.revenue > 0 ? `${s.revenueCurrency} ${Number(s.revenue).toLocaleString()}` : '—'}
                  </td>
                  <td className={`text-right py-4 px-5 font-mono font-medium ${
                    s.marginPct !== null && s.marginPct < 0 ? 'text-red-600' :
                    s.marginPct !== null && s.marginPct > 20 ? 'text-teal-600' : ''
                  }`}>
                    {s.marginPct !== null ? `${s.marginPct}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── TAB 3: Payment Urgency ───────────────────────────────────────────────────

function PaymentUrgencyTab({ data }: { data: any }) {
  const tickets: any[] = data.urgencyTickets || [];

  const groups = useMemo(() => ({
    overdue:  tickets.filter(t => t.urgency === 'overdue'),
    thisWeek: tickets.filter(t => t.urgency === 'this_week'),
    upcoming: tickets.filter(t => t.urgency === 'upcoming'),
  }), [tickets]);

  const urgencyConfig = [
    { key: 'overdue',  label: 'Overdue',              color: 'red',   Icon: AlertTriangle },
    { key: 'thisWeek', label: 'Due This Week',         color: 'amber', Icon: Clock },
    { key: 'upcoming', label: 'Due Within 30 Days',    color: 'blue',  Icon: Calendar },
  ] as const;

  const STATUS_LABEL: Record<string, string> = {
    pending: 'Pending', in_review: 'In Review', approved: 'Approved',
  };
  const STATUS_COLOR: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700', in_review: 'bg-blue-100 text-blue-700', approved: 'bg-teal-100 text-teal-700',
  };

  if (tickets.length === 0) {
    return (
      <div className="bg-card rounded-xl p-8 text-center border">
        <CheckCircle className="w-8 h-8 mx-auto text-teal-500/40" />
        <p className="text-[14.5px] text-muted-foreground mt-3">No payment urgency — all dues are clear</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {urgencyConfig.map(cfg => {
        const items = groups[cfg.key];
        if (items.length === 0) return null;
        return (
          <div key={cfg.key}>
            <h3 className={`text-[14.5px] font-semibold mb-2 flex items-center gap-1.5 text-${cfg.color}-600`}>
              <cfg.Icon className="w-4 h-4" />
              {cfg.label} ({items.length})
            </h3>
            <div className="space-y-1.5">
              {items.map((t: any) => {
                const dueDate = t.dueDate ? new Date(t.dueDate) : null;
                const daysOverdue = dueDate ? Math.ceil((Date.now() - dueDate.getTime()) / 86400000) : 0;
                const daysUntil = dueDate ? Math.ceil((dueDate.getTime() - Date.now()) / 86400000) : 0;
                return (
                  <div key={t.id} className={`bg-card rounded-lg p-3 flex items-center gap-3 flex-wrap border ${
                    cfg.key === 'overdue' ? 'border-l-4 border-l-red-500' :
                    cfg.key === 'thisWeek' ? 'border-l-4 border-l-amber-500' : ''
                  }`}>
                    <div className="w-[90px] shrink-0">
                      <div className="text-[13px] font-mono font-bold">{t.triggerEvent}</div>
                      <div className="text-[12px] text-muted-foreground">{t.entryType}</div>
                    </div>
                    <div className="w-[140px] shrink-0">
                      <div className="text-[13px] truncate">{t.vendorName || '—'}</div>
                      {t.shipment?.shipmentNumber && (
                        <div className="text-[13px] font-mono text-teal-600">{t.shipment.shipmentNumber}</div>
                      )}
                    </div>
                    <div className="w-[110px] shrink-0 font-mono text-[14.5px] font-medium">
                      {t.currency} {Number(t.amount || 0).toLocaleString()}
                    </div>
                    <div className="flex-1 min-w-0 text-[13px]">
                      {dueDate && (
                        <span className={cfg.key === 'overdue' ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
                          {cfg.key === 'overdue'
                            ? `${daysOverdue}d overdue (due ${dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })})`
                            : `Due ${dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} (${daysUntil}d)`
                          }
                        </span>
                      )}
                    </div>
                    <span className={`text-[12px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLOR[t.status] || 'bg-muted text-muted-foreground'}`}>
                      {STATUS_LABEL[t.status] || t.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── TAB 4: AP Aging ─────────────────────────────────────────────────────────

function ApAgingTab({ data }: { data: any }) {
  const aging = data.apAging || {};
  const vendors = Object.entries(aging).sort((a: any, b: any) => b[1].total - a[1].total);

  const bucketLabels = [
    { key: '0_30',    label: '0–30 days' },
    { key: '31_60',   label: '31–60 days' },
    { key: '61_90',   label: '61–90 days' },
    { key: '90_plus', label: '90+ days' },
  ];

  if (vendors.length === 0) {
    return (
      <div className="bg-card rounded-xl p-8 text-center border">
        <CheckCircle className="w-8 h-8 mx-auto text-teal-500/40" />
        <p className="text-[14.5px] text-muted-foreground mt-3">No outstanding payables</p>
      </div>
    );
  }

  const totals = bucketLabels.reduce((acc, b) => {
    acc[b.key] = vendors.reduce((s, [, v]: any) => s + (Number(v[b.key]) || 0), 0);
    return acc;
  }, {} as Record<string, number>);
  const grandTotal = vendors.reduce((s, [, v]: any) => s + Number(v.total || 0), 0);

  return (
    <div className="bg-card rounded-xl overflow-hidden border">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b bg-muted/20">
              <th className="text-left py-3 px-5 font-medium">Vendor</th>
              {bucketLabels.map(b => (
                <th key={b.key} className="text-right py-3 px-5 font-medium">{b.label}</th>
              ))}
              <th className="text-right py-3 px-5 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map(([vendor, buckets]: any) => (
              <tr key={vendor} className="border-b border-muted/20 hover:bg-muted/10">
                <td className="py-4 px-5">
                  <div className="font-medium">{vendor}</div>
                  <div className="text-[13px] text-muted-foreground">{buckets.currency}</div>
                </td>
                {bucketLabels.map(b => (
                  <td key={b.key} className={`text-right py-4 px-5 font-mono ${
                    b.key === '90_plus' && buckets[b.key] > 0 ? 'text-red-600 font-medium' :
                    b.key === '61_90' && buckets[b.key] > 0 ? 'text-amber-600' : ''
                  }`}>
                    {Number(buckets[b.key]) > 0 ? Number(buckets[b.key]).toLocaleString() : '—'}
                  </td>
                ))}
                <td className="text-right py-4 px-5 font-mono font-medium">
                  {Number(buckets.total).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/10 font-medium">
              <td className="py-3 px-5">Total</td>
              {bucketLabels.map(b => (
                <td key={b.key} className={`text-right py-3 px-5 font-mono ${b.key === '90_plus' && totals[b.key] > 0 ? 'text-red-600' : ''}`}>
                  {totals[b.key] > 0 ? totals[b.key].toLocaleString() : '—'}
                </td>
              ))}
              <td className="text-right py-3 px-5 font-mono">{grandTotal.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── TAB 5: Profitability / P&L ───────────────────────────────────────────────

function ProjectPnlTable({ projects }: { projects: any[] }) {
  const hasData = projects.some(p => p.shipmentCount > 0);
  if (!hasData) return <p className="text-[13px] text-muted-foreground py-4">No projects with cost data yet.</p>;

  return (
    <div className="bg-card rounded-xl overflow-hidden border">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b bg-muted/20">
              <th className="text-left py-3 px-5 font-medium">Project</th>
              <th className="text-left py-3 px-5 font-medium">Customer</th>
              <th className="text-center py-3 px-5 font-medium">Ships</th>
              <th className="text-right py-3 px-5 font-medium">Revenue</th>
              <th className="text-right py-3 px-5 font-medium">Cost</th>
              <th className="text-right py-3 px-5 font-medium">Margin</th>
              <th className="text-right py-3 px-5 font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {projects.filter(p => p.shipmentCount > 0).map((p: any) => (
              <tr key={p.projectId} className="border-b border-muted/20 hover:bg-muted/10">
                <td className="py-4 px-5">
                  <a href={`/projects/${p.projectId}`} className="font-mono text-teal-600 hover:underline">{p.projectCode}</a>
                </td>
                <td className="py-4 px-5 text-muted-foreground">{p.customerName || '—'}</td>
                <td className="text-center py-4 px-5 font-mono">{p.shipmentCount}</td>
                <td className="text-right py-4 px-5 font-mono">{p.totalRevenue > 0 ? Number(p.totalRevenue).toLocaleString() : '—'}</td>
                <td className="text-right py-4 px-5 font-mono">{Number(p.totalCost).toLocaleString()}</td>
                <td className={`text-right py-4 px-5 font-mono font-medium ${p.totalRevenue > 0 && p.margin < 0 ? 'text-red-600' : p.totalRevenue > 0 ? 'text-teal-600' : ''}`}>
                  {p.totalRevenue > 0 ? Number(p.margin).toLocaleString() : '—'}
                </td>
                <td className={`text-right py-4 px-5 font-mono ${p.marginPct !== null && p.marginPct < 0 ? 'text-red-600' : ''}`}>
                  {p.marginPct !== null ? `${p.marginPct}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShipmentPnlTable({ shipments }: { shipments: any[] }) {
  if (shipments.length === 0) return <p className="text-[13px] text-muted-foreground py-4">No shipments with cost data yet.</p>;

  return (
    <div className="bg-card rounded-xl overflow-hidden border">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b bg-muted/20">
              <th className="text-left py-3 px-5 font-medium">Shipment</th>
              <th className="text-left py-3 px-5 font-medium">Project</th>
              <th className="text-right py-3 px-5 font-medium">Revenue</th>
              <th className="text-right py-3 px-5 font-medium">Cost</th>
              <th className="text-right py-3 px-5 font-medium">Margin</th>
              <th className="text-right py-3 px-5 font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s: any) => (
              <tr key={s.shipmentId} className="border-b border-muted/20 hover:bg-muted/10">
                <td className="py-4 px-5">
                  <a href={`/shipments/${s.shipmentId}`} className="font-mono text-teal-600 hover:underline">{s.shipmentNumber || 'Pending'}</a>
                </td>
                <td className="py-4 px-5 text-muted-foreground font-mono text-[12px]">{s.projectCode || '—'}</td>
                <td className="text-right py-4 px-5 font-mono">{s.revenue > 0 ? `${s.revenueCurrency} ${Number(s.revenue).toLocaleString()}` : '—'}</td>
                <td className="text-right py-4 px-5 font-mono">{Number(s.totalCost).toLocaleString()}</td>
                <td className={`text-right py-4 px-5 font-mono font-medium ${s.margin !== null && s.margin < 0 ? 'text-red-600' : s.margin !== null && s.margin > 0 ? 'text-teal-600' : ''}`}>
                  {s.margin !== null ? Number(s.margin).toLocaleString() : '—'}
                </td>
                <td className={`text-right py-4 px-5 font-mono ${s.marginPct !== null && s.marginPct < 0 ? 'text-red-600' : ''}`}>
                  {s.marginPct !== null ? `${s.marginPct}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProfitabilityTab({ data }: { data: any }) {
  const [viewLevel, setViewLevel] = useState<'project' | 'shipment'>('project');
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex rounded-lg border overflow-hidden">
          <button onClick={() => setViewLevel('project')} className={`px-3 py-1.5 text-[13px] font-medium transition-colors ${viewLevel === 'project' ? 'bg-teal-600 text-white' : 'hover:bg-muted'}`}>By Project</button>
          <button onClick={() => setViewLevel('shipment')} className={`px-3 py-1.5 text-[13px] font-medium transition-colors ${viewLevel === 'shipment' ? 'bg-teal-600 text-white' : 'hover:bg-muted'}`}>By Shipment</button>
        </div>
        {viewLevel === 'project' && (
          <span className="text-[13px] text-muted-foreground">{(data.projectPnl || []).filter((p: any) => p.shipmentCount > 0).length} projects with shipments</span>
        )}
      </div>
      {viewLevel === 'project'
        ? <ProjectPnlTable projects={data.projectPnl || []} />
        : <ShipmentPnlTable shipments={data.shipmentCosts || []} />
      }
    </div>
  );
}

// ─── TAB 6: Cost Analytics ────────────────────────────────────────────────────

function CostAnalyticsTab({ data }: { data: any }) {
  const monthly = data.costAnalytics || {};
  const months = Object.keys(monthly).filter(m => m !== 'unknown').sort();

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const m of Object.values(monthly) as any[]) {
      for (const cat of Object.keys(m)) cats.add(cat);
    }
    return [...cats].sort();
  }, [monthly]);

  if (months.length === 0) {
    return (
      <div className="bg-card rounded-xl p-8 text-center border">
        <BarChart3 className="w-8 h-8 mx-auto text-muted-foreground/30" />
        <p className="text-[14.5px] text-muted-foreground mt-3">No posted tickets to analyze yet</p>
        <p className="text-[13px] text-muted-foreground mt-1">Cost analytics appears once tickets are posted to ERP</p>
      </div>
    );
  }

  const monthTotals = months.map(m => Object.values(monthly[m] as Record<string, number>).reduce((s, v) => s + v, 0));
  const maxMonthTotal = Math.max(...monthTotals, 1);

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-4">
        {allCategories.map((cat, i) => (
          <div key={cat} className="flex items-center gap-1.5 text-[13px]">
            <div className={`w-3 h-3 rounded-sm shrink-0 ${categoryColors[i % 8]}`} />
            <span className="text-muted-foreground">{cat}</span>
          </div>
        ))}
      </div>

      {/* Stacked bar chart */}
      <div className="bg-card rounded-xl p-5 mb-4 border">
        <h3 className="text-[13px] font-semibold text-muted-foreground mb-4 uppercase tracking-wide">Monthly Posted Costs</h3>
        <div className="space-y-2.5">
          {months.map((month, mi) => {
            const cats = monthly[month] as Record<string, number>;
            const total = monthTotals[mi];
            const barWidth = (total / maxMonthTotal) * 100;
            return (
              <div key={month} className="flex items-center gap-3">
                <span className="text-[13px] font-mono text-muted-foreground w-16 shrink-0 text-right">{month.replace(/^(\d{4})-(\d{2})$/, (_, y, m2) => {
                  const mo = new Date(+y, +m2 - 1).toLocaleString('en-IN', { month: 'short' });
                  return `${mo} '${y.slice(2)}`;
                })}</span>
                <div className="flex-1 h-6 bg-muted/10 rounded overflow-hidden">
                  <div className="h-full flex" style={{ width: `${Math.max(barWidth, 2)}%` }}>
                    {allCategories.map((cat, ci) => {
                      const amount = cats[cat] || 0;
                      if (amount === 0) return null;
                      const pct = (amount / total) * 100;
                      return (
                        <div
                          key={cat}
                          className={`h-full ${categoryColors[ci % 8]} flex items-center justify-center overflow-hidden`}
                          style={{ width: `${pct}%`, minWidth: pct > 8 ? '18px' : '2px' }}
                          title={`${cat}: ${Number(amount).toLocaleString()}`}
                        >
                          {pct > 15 && (
                            <span className="text-[8px] text-white font-mono px-0.5">
                              {Number(amount / 1000).toFixed(0)}K
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <span className="text-[13px] font-mono text-muted-foreground w-20 text-right shrink-0">
                  {Number(total).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Data table */}
      <div className="bg-card rounded-xl overflow-hidden border">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/20">
                <th className="text-left py-3 px-5 font-medium">Month</th>
                {allCategories.map(cat => (
                  <th key={cat} className="text-right py-3 px-5 font-medium">{cat}</th>
                ))}
                <th className="text-right py-3 px-5 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {months.map((month, mi) => {
                const cats = monthly[month] as Record<string, number>;
                return (
                  <tr key={month} className="border-b border-muted/20 hover:bg-muted/10">
                    <td className="py-4 px-5 font-mono">{month}</td>
                    {allCategories.map(cat => (
                      <td key={cat} className="text-right py-4 px-5 font-mono">
                        {cats[cat] ? Number(cats[cat]).toLocaleString() : '—'}
                      </td>
                    ))}
                    <td className="text-right py-4 px-5 font-mono font-medium">{Number(monthTotals[mi]).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = [
  { value: 'summary',   label: 'Overview' },
  { value: 'cost_view', label: 'Shipment Costs' },
  { value: 'urgency',   label: 'Payment Urgency' },
  { value: 'aging',     label: 'AP Aging' },
  { value: 'pnl',       label: 'Profitability' },
  { value: 'analytics', label: 'Cost Analytics' },
];

export function FinanceDashboardPage() {
  const [dashData, setDashData] = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('summary');

  useEffect(() => {
    fetch('/api/accounting/dashboard', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setDashData(d.data); }
        else { setError(d.error || 'Failed to load dashboard'); }
        setLoading(false);
      })
      .catch(() => { setError('Network error'); setLoading(false); });
  }, []);

  // Urgency + aging badge counts for tab labels
  const urgencyCount = dashData?.urgencyTickets?.length ?? 0;
  const agingOverdue = dashData ? Object.values(dashData.apAging || {}).reduce((s: number, v: any) => s + (Number(v['90_plus']) || 0), 0) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>Finance Dashboard</h1>
        <p className="text-[14.5px] text-muted-foreground mt-0.5">Analytics across accounting tickets, shipment costs, and project P&L</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
        {TABS.map(tab => {
          const badge = tab.value === 'urgency' && urgencyCount > 0 ? urgencyCount : null;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-3 py-1.5 text-[13px] font-medium rounded-full whitespace-nowrap transition-colors flex items-center gap-1 ${
                activeTab === tab.value ? 'bg-teal-600 text-white' : 'bg-muted hover:bg-muted/70'
              }`}
            >
              {tab.label}
              {badge && (
                <span className={`text-[12px] px-1 rounded-full ${activeTab === tab.value ? 'bg-white/20' : 'bg-amber-100 text-amber-700'}`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl h-24 bg-muted/20 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-50 rounded-xl p-6 border border-red-200 text-center">
          <p className="text-[14.5px] text-red-700 font-medium">{error}</p>
        </div>
      )}

      {!loading && !error && dashData && (
        <>
          {activeTab === 'summary'   && <OverviewTab         data={dashData} />}
          {activeTab === 'cost_view' && <ShipmentCostTab     data={dashData} />}
          {activeTab === 'urgency'   && <PaymentUrgencyTab   data={dashData} />}
          {activeTab === 'aging'     && <ApAgingTab          data={dashData} />}
          {activeTab === 'pnl'       && <ProfitabilityTab    data={dashData} />}
          {activeTab === 'analytics' && <CostAnalyticsTab    data={dashData} />}
        </>
      )}
    </div>
  );
}
