import { useState, useEffect, useMemo } from 'react';
import { getAuthToken } from '@/lib/api';
import { useConfig } from '@/contexts/ConfigContext';
import { Download, Search, ClipboardList } from 'lucide-react';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── CSV export ──────────────────────────────────────────────────────────────

function exportCsv(rows: any[]) {
  const headers = [
    'Shipment', 'Project', 'Exporter', 'Buyer', 'Status',
    'Current Gate', 'Gate #', 'Passed/Total', 'Days in Gate',
    'Doc %', 'Closed Docs', 'Total Docs', 'Pending Docs',
    'Val Failed', 'Val Waiting', 'Val Total',
    'Last Milestone', 'Milestones Done',
    'D&D Accruing', 'D&D Amount', 'D&D Currency',
    'ETA Port', 'ETA Delivery',
    'Pending Tickets', 'Ticket Amount',
    'Next Action', 'Open Tasks',
  ];
  const csvRows = rows.map(r => [
    r.shipmentNumber, r.projectCode, r.exporterName, r.buyerName, r.status,
    r.currentGate, r.currentGateNumber ?? '', `${r.passedGates}/${r.totalGates}`, r.daysInGate ?? '',
    r.docPct, r.closedDocs, r.totalDocs, r.pendingDocs,
    r.valFailed, r.valWaiting, r.valTotal,
    r.lastMilestone ?? '', `${r.completedMilestones}/${r.totalMilestones}`,
    r.dndAccruingCount, r.dndTotal || '', r.dndCurrency,
    r.etaPort ? new Date(r.etaPort).toISOString().split('T')[0] : '',
    r.etaDelivery ? new Date(r.etaDelivery).toISOString().split('T')[0] : '',
    r.pendingTickets, r.pendingTicketAmount || '',
    r.nextAction ?? '', r.openTasks,
  ]);
  const csv = [headers, ...csvRows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DSR_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── DsrRow ──────────────────────────────────────────────────────────────────

function DsrRow({ row }: { row: any }) {
  return (
    <tr className={`border-b border-muted/20 hover:bg-muted/10 ${
      row.isBlocked ? 'bg-red-50/30 dark:bg-red-950/10' :
      row.dndAccruingCount > 0 ? 'bg-amber-50/20' : ''
    }`}>
      {/* Shipment */}
      <td className="py-3 px-3 sticky left-0 bg-card z-10">
        <a href={`/shipments/${row.shipmentId}`} className="data-mono-id text-teal-600 hover:underline">
          {row.shipmentNumber}
        </a>
        <div className="text-[13px] text-muted-foreground truncate max-w-[100px]">{row.exporterName}</div>
      </td>

      {/* Project */}
      <td className="py-3 px-3">
        {row.projectCode
          ? <a href={`/projects/${row.projectId}`} className="data-mono-id text-muted-foreground hover:underline">{row.projectCode}</a>
          : <span className="text-muted-foreground/30">—</span>
        }
      </td>

      {/* Current gate */}
      <td className="py-3 px-3">
        <div className={`font-medium text-[13px] ${row.isBlocked ? 'text-red-600' : ''}`}>
          {row.currentGate}
        </div>
        <div className="text-[12px] text-muted-foreground">{row.passedGates}/{row.totalGates} passed</div>
      </td>

      {/* Days in gate */}
      <td className="text-center py-3 px-3">
        {row.daysInGate !== null
          ? <span
              className={`data-elapsed-time ${row.daysInGate > 5 ? 'text-red-600' : row.daysInGate > 3 ? 'text-amber-600' : ''}`}
              style={row.daysInGate > 5 ? { fontWeight: 600 } : undefined}
            >
              {row.daysInGate}d
            </span>
          : <span className="text-muted-foreground/30">—</span>
        }
      </td>

      {/* Doc completion */}
      <td className="text-center py-2 px-2">
        <div className="flex items-center gap-1 justify-center">
          <div className="h-1.5 w-10 rounded-full bg-muted/50 overflow-hidden">
            <div className="h-full rounded-full bg-teal-500" style={{ width: `${row.docPct}%` }} />
          </div>
          <span className="data-metric-value">{row.docPct}%</span>
        </div>
        {row.pendingDocs > 0 && (
          <div className="text-[8px] text-amber-600 text-center">{row.pendingDocs} pending</div>
        )}
      </td>

      {/* Validation */}
      <td className="text-center py-3 px-3 text-[13px]">
        {row.valTotal === 0
          ? <span className="text-muted-foreground/30">—</span>
          : row.valFailed > 0
          ? <span className="text-red-600 font-medium">{row.valFailed} fail</span>
          : row.valWaiting > 0
          ? <span className="text-amber-600">{row.valWaiting} wait</span>
          : <span className="text-teal-600">✓ OK</span>
        }
      </td>

      {/* Last milestone */}
      <td className="py-3 px-3">
        <div className="text-[13px] truncate max-w-[90px]">{row.lastMilestone || <span className="text-muted-foreground/30">—</span>}</div>
        {row.totalMilestones > 0 && (
          <div className="text-[8px] text-muted-foreground">{row.completedMilestones}/{row.totalMilestones}</div>
        )}
        {row.containerMsBreakdown && row.containerMsBreakdown.total > 0 && (
          <div className="text-[8px] text-teal-600">
            {row.containerMsBreakdown.completed}/{row.containerMsBreakdown.total} ctn-ms
          </div>
        )}
      </td>

      {/* D&D */}
      <td className="py-3 px-3">
        {row.dndAccruingCount > 0 ? (
          <div>
            <span className="data-currency-value block text-red-600">
              {row.dndCurrency} {Number(row.dndTotal).toLocaleString()}
            </span>
            <div className="text-[12px] text-red-400 text-right">{row.dndAccruingCount} accruing</div>
          </div>
        ) : row.dndMonitoringCount > 0 ? (
          <div>
            <span className="text-amber-600 text-[13px]">{row.dndMonitoringCount} monitoring</span>
            {row.nearestLfd && (
              <div className="text-[8px] text-muted-foreground">
                LFD: {new Date(row.nearestLfd).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
              </div>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground/30">—</span>
        )}
      </td>

      {/* ETA */}
      <td className="py-3 px-3 data-timestamp">
        {row.etaPort ? (
          <div>
            <div>{new Date(row.etaPort).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
            {row.etaDelivery && (
              <div className="text-[8px] text-muted-foreground">
                Del: {new Date(row.etaDelivery).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
              </div>
            )}
          </div>
        ) : <span className="text-muted-foreground/30">—</span>}
      </td>

      {/* Finance */}
      <td className="py-3 px-3">
        {row.pendingTickets > 0 ? (
          <div>
            <span className="data-currency-value block">
              {row.pendingTicketCurrency} {Number(row.pendingTicketAmount).toLocaleString()}
            </span>
            <div className="text-[8px] text-muted-foreground text-right">{row.pendingTickets} ticket{row.pendingTickets !== 1 ? 's' : ''}</div>
          </div>
        ) : <span className="text-muted-foreground/30">—</span>}
      </td>

      {/* Next action */}
      <td className="py-3 px-3">
        {row.nextAction ? (
          <div>
            <div className="truncate max-w-[130px] text-[13px]">{row.nextAction}</div>
            {row.nextActionUrgency === 'BLOCKER' && (
              <span className="text-[8px] text-red-600 font-medium">BLOCKER</span>
            )}
            {row.nextActionUrgency === 'WARNING' && (
              <span className="text-[8px] text-amber-600">WARNING</span>
            )}
            {row.openTasks > 1 && (
              <span className="text-[8px] text-muted-foreground ml-1">+{row.openTasks - 1} more</span>
            )}
          </div>
        ) : (
          <span className="text-teal-600 text-[13px]">No pending actions</span>
        )}
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function DsrReportPage() {
  const [rows, setRows]           = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [templateFilter, setTemplateFilter] = useState('all');
  const [statusFilter, setStatusFilter]     = useState('ACTIVE');
  const [searchQuery, setSearchQuery]       = useState('');

  const { templates } = useConfig();
  const activeTemplates = templates.filter(t => t.templateStatus === 'ACTIVE');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (templateFilter !== 'all') params.set('templateId', templateFilter);
    params.set('status', statusFilter === 'all' ? 'ALL' : statusFilter);

    fetch(`/api/reports/dsr?${params}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        if (d.ok) setRows(d.data || []);
        else setError(d.error || 'Failed to load DSR');
        setLoading(false);
      })
      .catch(() => { setError('Network error'); setLoading(false); });
  }, [templateFilter, statusFilter]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter(r =>
      r.shipmentNumber.toLowerCase().includes(q) ||
      r.projectCode.toLowerCase().includes(q) ||
      r.exporterName.toLowerCase().includes(q) ||
      r.buyerName.toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

  const stats = useMemo(() => ({
    total:    filtered.length,
    blocked:  filtered.filter(r => r.isBlocked).length,
    dndRisk:  filtered.filter(r => r.dndAccruingCount > 0).length,
    avgDocPct: filtered.length > 0
      ? Math.round(filtered.reduce((s, r) => s + r.docPct, 0) / filtered.length)
      : 0,
  }), [filtered]);

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: 0, color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>Daily Status Report</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {today} · {stats.total} shipment{stats.total !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => exportCsv(filtered)}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 text-[13px] px-3 py-2 border rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Summary pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="text-[13px] px-2.5 py-1 rounded-full bg-muted font-medium">{stats.total} active</span>
        {stats.blocked > 0 && (
          <span className="text-[13px] px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-medium">
            {stats.blocked} blocked
          </span>
        )}
        {stats.dndRisk > 0 && (
          <span className="text-[13px] px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
            {stats.dndRisk} D&amp;D risk
          </span>
        )}
        <span className="text-[13px] px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 font-medium">
          Avg docs: {stats.avgDocPct}%
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search shipment, project, exporter…"
            className="w-full text-[14px] border rounded-lg pl-8 pr-3 py-1.5 bg-background"
          />
        </div>
        {activeTemplates.length > 1 && (
          <select
            value={templateFilter}
            onChange={e => setTemplateFilter(e.target.value)}
            className="text-[14px] border rounded-lg px-2 py-1.5 bg-background"
          >
            <option value="all">All corridors</option>
            {activeTemplates.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-[14px] border rounded-lg px-2 py-1.5 bg-background"
        >
          <option value="ACTIVE">Active only</option>
          <option value="ACTIVE,PENDING">Active + Pending</option>
          <option value="all">All statuses</option>
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-muted/20 animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-sm text-red-700 font-medium">{error}</p>
        </div>
      )}

      {/* DSR Matrix */}
      {!loading && !error && (
        <>
          <div className="bg-card rounded-lg overflow-hidden border">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b bg-muted/30 text-muted-foreground">
                    <th className="text-left py-3 px-3 font-medium sticky left-0 bg-muted/30 z-10 whitespace-nowrap">Shipment</th>
                    <th className="text-left py-3 px-3 font-medium whitespace-nowrap">Project</th>
                    <th className="text-left py-3 px-3 font-medium whitespace-nowrap">Gate</th>
                    <th className="text-center py-3 px-3 font-medium whitespace-nowrap">Days</th>
                    <th className="text-center py-3 px-3 font-medium whitespace-nowrap">Docs</th>
                    <th className="text-center py-3 px-3 font-medium whitespace-nowrap">Validation</th>
                    <th className="text-left py-3 px-3 font-medium whitespace-nowrap">Milestone</th>
                    <th className="text-left py-3 px-3 font-medium whitespace-nowrap">D&amp;D</th>
                    <th className="text-left py-3 px-3 font-medium whitespace-nowrap">ETA</th>
                    <th className="text-left py-3 px-3 font-medium whitespace-nowrap">Finance</th>
                    <th className="text-left py-3 px-3 font-medium whitespace-nowrap">Next Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => (
                    <DsrRow key={row.shipmentId} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {filtered.length === 0 && (
            <div className="bg-card rounded-lg p-10 text-center mt-2 border">
              <ClipboardList className="w-8 h-8 mx-auto text-muted-foreground/30" />
              <p className="text-[14.5px] text-muted-foreground mt-3">
                {rows.length === 0 ? 'No active shipments found' : 'No shipments match your search'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
