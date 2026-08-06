import { useState, useEffect, useMemo, type ElementType } from 'react';
import {
  Ship, Clock, AlertTriangle, Ban, ClipboardList, DollarSign, CheckCircle, Boxes, Package,
} from 'lucide-react';
import { useShipments, useTaskCount } from '@/hooks/useOperationalData';
import { usePermissions } from '@/contexts/PermissionContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTemplates } from '@/contexts/ConfigContext';
import { MetricCard } from '@/components/vs/MetricCard';
import { StatusBadge } from '@/components/StatusBadge';
import { getAuthToken } from '@/lib/api';
import { BACKEND_API_BASE as API_BASE } from '@/lib/apiBase';

function authFetchHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type GateHealthCargoKey = 'container' | 'breakBulk';
type GateHealthStats = {
  name: string;
  cargo: Record<GateHealthCargoKey, { active: number; blocked: number }>;
};

function emptyGateCargoStats(): GateHealthStats['cargo'] {
  return {
    container: { active: 0, blocked: 0 },
    breakBulk: { active: 0, blocked: 0 },
  };
}

function cargoKindForShipment(shipment: any): GateHealthCargoKey {
  const raw = [
    shipment?.shipmentType,
    shipment?.cargoType,
    shipment?.loadType,
    ...(Array.isArray(shipment?.shipmentTypes) ? shipment.shipmentTypes : []),
  ].filter(Boolean).join(' ').toLowerCase();

  return raw.includes('break') || raw.includes('bulk') || raw.includes('roro') ? 'breakBulk' : 'container';
}

function GateHealthCard({ gateNumber, data }: { gateNumber: string; data: GateHealthStats }) {
  const rows: Array<{ key: GateHealthCargoKey; label: string; Icon: ElementType }> = [
    { key: 'container', label: 'Container', Icon: Boxes },
    { key: 'breakBulk', label: 'Break-bulk', Icon: Package },
  ];

  return (
    <div className="rounded-lg border border-card-border bg-card p-6">
      <div className="mb-4">
        <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
          Gate {gateNumber}
        </div>
        <div className="truncate text-base font-medium leading-5 text-foreground">{data.name}</div>
      </div>
      <div className="space-y-3">
        {rows.map(({ key, label, Icon }) => {
          const stats = data.cargo[key];
          return (
            <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate text-sm text-foreground">{label}</span>
              </div>
              <div className="text-right">
                <div className="text-[18px] font-semibold leading-[1.2] text-[hsl(var(--vs-success))] tabular-nums">
                  {stats.active}
                </div>
                <div className="text-[11px] leading-[1.3] text-muted-foreground">Active</div>
              </div>
              <div className="text-right">
                <div className="text-[18px] font-semibold leading-[1.2] text-destructive tabular-nums">
                  {stats.blocked}
                </div>
                <div className="text-[11px] leading-[1.3] text-muted-foreground">Blocked</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MetricCard ──────────────────────────────────────────────────────────────

// ─── StatusBadge ─────────────────────────────────────────────────────────────

// ─── DashboardPage ───────────────────────────────────────────────────────────

export function DashboardPage() {
  const { user } = useAuth();
  const { gates: permittedGates, modules } = usePermissions();
  const templates = useTemplates();

  const [templateFilter, setTemplateFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'gate' | 'eta'>('newest');
  const [dndSummary, setDndSummary] = useState<any>(null);

  const shipmentFilters = useMemo(
    () => (templateFilter !== 'all' ? { templateId: templateFilter } : {}),
    [templateFilter],
  );

  const { shipments, loading } = useShipments(shipmentFilters);
  const { count: taskCount } = useTaskCount();

  // Fetch D&D summary
  useEffect(() => {
    fetch(`${API_BASE}/api/dnd/summary`, { headers: authFetchHeaders() })
      .then(r => r.json())
      .then(d => { if (d.ok) setDndSummary(d.data); })
      .catch(() => {});
  }, []);

  // Set of permitted gate numbers (accessLevel !== 'none')
  const permittedGateNumbers = useMemo(
    () => new Set(permittedGates.filter(g => g.accessLevel !== 'none').map(g => g.gateNumber)),
    [permittedGates],
  );

  // Normalise status to uppercase for comparison (API returns lowercase)
  const normStatus = (s: any) => (s?.status ?? '').toUpperCase();

  // Metric computations
  const metrics = useMemo(() => ({
    active:    shipments.filter(s => normStatus(s) === 'ACTIVE').length,
    pending:   shipments.filter(s => normStatus(s) === 'PENDING').length,
    completed: shipments.filter(s => normStatus(s) === 'COMPLETED').length,
    blocked:   shipments.filter(s =>
      (s.shipmentGates ?? []).some((g: any) => String(g.status ?? '').toUpperCase() === 'BLOCKED'),
    ).length,
    myTasks:  taskCount.total,
    dndRisk:  dndSummary?.accruing ?? 0,
  }), [shipments, taskCount.total, dndSummary]);

  // Gate health distribution (only user-permitted gates)
  const gateDistribution = useMemo(() => {
    const dist: Record<number, GateHealthStats> = {};
    for (const g of permittedGates) {
      if (g.accessLevel !== 'none') {
        dist[g.gateNumber] = { name: g.gateName, cargo: emptyGateCargoStats() };
      }
    }
    for (const s of shipments) {
      const cargoKind = cargoKindForShipment(s);
      for (const sg of (s.shipmentGates ?? [])) {
        const num: number = sg.gateConfig?.gateNumber;
        if (!dist[num]) continue;
        const status = String(sg.status ?? '').toUpperCase();
        if (status === 'ACTIVE') dist[num].cargo[cargoKind].active += 1;
        else if (status === 'BLOCKED') dist[num].cargo[cargoKind].blocked += 1;
      }
    }
    return dist;
  }, [shipments, permittedGates]);

  // Filtered + sorted shipment list
  const filteredShipments = useMemo(() => {
    let result = [...shipments];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        (s.shipmentNumber ?? '').toLowerCase().includes(q) ||
        (s.exporterName   ?? '').toLowerCase().includes(q) ||
        (s.buyerName      ?? '').toLowerCase().includes(q) ||
        (s.projectName    ?? '').toLowerCase().includes(q),
      );
    }
    if (statusFilter !== 'all') {
      if (statusFilter === 'blocked') {
        result = result.filter(s => (s.shipmentGates ?? []).some((g: any) => String(g.status ?? '').toUpperCase() === 'BLOCKED'));
      } else {
        result = result.filter(s => normStatus(s) === statusFilter.toUpperCase());
      }
    }
    switch (sortBy) {
      case 'newest':
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'oldest':
        result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case 'gate':
        result.sort((a, b) => {
          const aG = (a.shipmentGates ?? []).find((g: any) => String(g.status ?? '').toUpperCase() === 'ACTIVE')?.gateConfig?.gateNumber ?? 99;
          const bG = (b.shipmentGates ?? []).find((g: any) => String(g.status ?? '').toUpperCase() === 'ACTIVE')?.gateConfig?.gateNumber ?? 99;
          return aG - bG;
        });
        break;
      case 'eta':
        result.sort((a, b) => {
          const aEta = (a as any).etaPort ? new Date((a as any).etaPort).getTime() : Infinity;
          const bEta = (b as any).etaPort ? new Date((b as any).etaPort).getTime() : Infinity;
          return aEta - bEta;
        });
        break;
    }
    return result;
  }, [shipments, search, statusFilter, sortBy]);

  const hasDndAccess  = modules.includes('dnd') || modules.includes('inventory');
  const hasGateAccess = permittedGates.some(g => g.accessLevel !== 'none');
  const activeTemplates = (templates as any[]).filter((t: any) => t.templateStatus === 'ACTIVE');

  return (
    <div className="ewms-content-container p-8">

      {/* ── Escalation Banner ─────────────────────────────────────────────── */}
      {taskCount.blockers > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-semibold text-red-700 dark:text-red-400">
              {taskCount.blockers} blocker{taskCount.blockers > 1 ? 's' : ''} — workflow stopped
            </span>
            <span className="text-[13px] text-red-600/70">Immediate action required</span>
          </div>
          <a href="/tasks?urgency=BLOCKER" className="text-[13px] font-medium text-red-600 hover:underline">
            View blockers →
          </a>
        </div>
      )}

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: 0, color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Welcome back, {user?.fullName ?? user?.email ?? 'User'}
          </p>
        </div>
        {activeTemplates.length > 1 && (
          <select
            value={templateFilter}
            onChange={e => setTemplateFilter(e.target.value)}
            className="text-sm border rounded-md px-3 py-1.5 bg-background"
          >
            <option value="all">All corridors</option>
            {activeTemplates.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.corridor ? ` (${t.corridor})` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── Metric Cards ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="ewms-metric-grid-auto mb-6">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-[185px] rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="ewms-metric-grid-auto mb-6">
          <MetricCard
            variant="dashboard"
            label="Active"
            value={metrics.active}
            icon={Ship}
            color="teal"
            sideStats={[
              { value: metrics.pending, label: 'Pending' },
              { value: metrics.completed, label: 'Completed' },
            ]}
          />
          <MetricCard
            variant="dashboard"
            label="Pending ID"
            value={metrics.pending}
            icon={Clock}
            color="amber"
            sideStats={[
              { value: metrics.active, label: 'Active' },
              { value: metrics.blocked, label: 'Blocked' },
            ]}
          />
          <MetricCard
            variant="dashboard"
            label="At Risk"
            value={0}
            icon={AlertTriangle}
            color="amber"
            sideStats={[
              { value: metrics.blocked, label: 'Blocked' },
              { value: metrics.dndRisk, label: 'D&D' },
            ]}
          />
          <MetricCard
            variant="dashboard"
            label="Blocked"
            value={metrics.blocked}
            icon={Ban}
            color="red"
            href="/shipments?status=blocked"
            sideStats={[
              { value: metrics.active, label: 'Active' },
              { value: metrics.pending, label: 'Pending' },
            ]}
          />
          <MetricCard
            variant="dashboard"
            label="My Tasks"
            value={metrics.myTasks}
            icon={ClipboardList}
            color="blue"
            href="/tasks"
            badge={taskCount.blockers > 0 ? `${taskCount.blockers}!` : undefined}
            sideStats={[
              { value: taskCount.blockers, label: 'Blockers' },
              { value: taskCount.total, label: 'Total' },
            ]}
          />
          {hasDndAccess && (
            <MetricCard
              variant="dashboard"
              label="D&D Risk"
              value={metrics.dndRisk}
              icon={DollarSign}
              color="red"
              href="/inventory/dnd"
              sideStats={[
                { value: dndSummary?.upcomingLfd7d ?? 0, label: 'LFD 7d' },
                { value: `$${Number(dndSummary?.totalAccruedCharge ?? 0).toLocaleString()}`, label: 'Value' },
              ]}
            />
          )}
          <MetricCard
            variant="dashboard"
            label="Completed"
            value={metrics.completed}
            icon={CheckCircle}
            color="green"
            sideStats={[
              { value: metrics.active, label: 'Active' },
              { value: shipments.length, label: 'Total' },
            ]}
          />
        </div>
      )}

      {/* ── D&D Risk Banner ───────────────────────────────────────────────── */}
      {hasDndAccess && dndSummary && dndSummary.accruing > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DollarSign className="w-4 h-4 text-amber-600" />
            <span className="text-sm text-amber-800 dark:text-amber-300">
              <strong>{dndSummary.accruing}</strong> container{dndSummary.accruing > 1 ? 's' : ''} accruing D&amp;D
              {' — '}
              <span className="font-mono">${Number(dndSummary.totalAccruedCharge ?? 0).toLocaleString()}</span> total
            </span>
            {dndSummary.upcomingLfd7d > 0 && (
              <span className="text-[13px] text-amber-600/70 ml-2">
                + {dndSummary.upcomingLfd7d} LFD{dndSummary.upcomingLfd7d > 1 ? 's' : ''} this week
              </span>
            )}
          </div>
          <a href="/inventory/dnd" className="text-[13px] font-medium text-amber-700 hover:underline">
            View D&amp;D →
          </a>
        </div>
      )}

      {/* ── Gate Health Bar ───────────────────────────────────────────────── */}
      {hasGateAccess && Object.keys(gateDistribution).length > 0 && (
        <section className="mb-6">
          <h3 className="mb-3 text-lg font-semibold leading-[1.3] text-foreground">Gate Health</h3>
          <div className="ewms-card-grid-auto">
            {Object.entries(gateDistribution)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([num, data]) => (
                <GateHealthCard key={num} gateNumber={num} data={data} />
              ))}
          </div>
        </section>
      )}

      {/* ── Shipment Table ────────────────────────────────────────────────── */}
      <div className="bg-card rounded-lg p-6">

        {/* Controls */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-lg font-bold">
            Shipments{' '}
            <span className="text-muted-foreground font-normal text-base">({filteredShipments.length})</span>
          </h3>
          <div className="flex gap-2 flex-wrap">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search shipments..."
              className="text-sm border rounded-md px-3 py-1.5 w-48 bg-background"
            />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border rounded-md px-2 py-1.5 bg-background"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="pending">Pending ID</option>
              <option value="blocked">Blocked</option>
              <option value="completed">Completed</option>
              <option value="on_hold">On Hold</option>
            </select>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'newest' | 'oldest' | 'gate' | 'eta')}
              className="text-sm border rounded-md px-2 py-1.5 bg-background"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="gate">By gate</option>
              <option value="eta">By ETA</option>
            </select>
          </div>
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-lg p-4 bg-muted/20 animate-pulse h-16" />
            ))}
          </div>
        )}

        {/* Column headers */}
        {!loading && filteredShipments.length > 0 && (
          <div className="flex items-center gap-5 pt-1 pb-2 mb-2 border-b border-border overflow-x-auto" style={{ paddingLeft: 21, paddingRight: 20 }}>
            <div className="min-w-[140px] flex-[1.4] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Shipment</div>
            <div className="min-w-[120px] flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Gates</div>
            <div className="min-w-[60px] flex-[0.6] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden lg:block">Docs</div>
            <div className="min-w-[56px] flex-[0.5] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right hidden xl:block">ETA</div>
            <div className="flex-[2] min-w-[120px] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Exporter / Buyer</div>
            <div className="min-w-[64px] flex-[0.6] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right hidden md:block">Counts</div>
            <div className="min-w-[56px] flex-[0.5] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Added</div>
          </div>
        )}

        {/* Rows */}
        {!loading && (
          <div className="overflow-x-auto">
            <div className="min-w-[820px] space-y-2">
            {filteredShipments.map(shipment => {
              const visibleGates = (shipment.shipmentGates ?? [])
                .filter((g: any) => permittedGateNumbers.has(g.gateConfig?.gateNumber))
                .sort((a: any, b: any) =>
                  (a.gateConfig?.gateNumber ?? 0) - (b.gateConfig?.gateNumber ?? 0),
                );

              return (
                <a
                  key={shipment.id}
                  href={`/shipments/${shipment.id}`}
                  className="bg-background rounded-lg px-5 py-4 flex items-center gap-5 hover:shadow-md transition-shadow cursor-pointer border border-transparent hover:border-border"
                >
                  {/* Shipment ID + status + project link */}
                  <div className="min-w-[140px] flex-[1.4]">
                    <div className="font-mono text-[15px] font-semibold leading-tight">
                      {shipment.shipmentNumber || (
                        <span className="text-muted-foreground italic text-[13px] font-normal">Pending ID</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <StatusBadge status={shipment.status} />
                    </div>
                    {(shipment as any).project && (
                      <button
                        type="button"
                        onClick={e => { e.preventDefault(); e.stopPropagation(); window.location.href = `/projects/${(shipment as any).project.id}`; }}
                        className="text-[13px] text-teal-600 hover:underline font-mono mt-1 block"
                      >
                        {(shipment as any).project.projectCode}
                      </button>
                    )}
                  </div>

                  {/* Gate progress dots */}
                  <div className="flex items-center gap-1.5 min-w-[120px] flex-1 flex-wrap">
                    {visibleGates.map((gate: any) => {
                      const gNum = gate.gateConfig?.gateNumber;
                      return (
                        <div
                          key={gate.id}
                          title={`${gate.gateConfig?.gateName ?? `G${gNum}`}: ${gate.status}`}
                        >
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold ${
                            gate.status === 'PASSED'  ? 'bg-teal-500 text-white' :
                            gate.status === 'ACTIVE'  ? 'bg-teal-500/20 text-teal-700 ring-2 ring-teal-500' :
                            gate.status === 'BLOCKED' ? 'bg-red-500 text-white animate-pulse' :
                            gate.status === 'SKIPPED' ? 'bg-muted text-muted-foreground' :
                            'bg-muted/50 text-muted-foreground'
                          }`}>
                            {gNum}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Doc completion mini-bar */}
                  <div className="min-w-[60px] flex-[0.6] hidden lg:block">
                    <div className="flex items-center gap-2">
                      <div className="h-2 rounded-full bg-muted/50 overflow-hidden flex-1">
                        <div className="h-full rounded-full bg-teal-500" style={{ width: `${(shipment as any).docCompletionPct || 0}%` }} />
                      </div>
                      <span className="text-[13px] font-mono text-muted-foreground">{(shipment as any).docCompletionPct || 0}%</span>
                    </div>
                  </div>

                  {/* ETA */}
                  <div className="min-w-[56px] flex-[0.5] text-right hidden xl:block">
                    {(shipment as any).etaPort ? (
                      <div className="text-[12px]">
                        <span className="text-muted-foreground">ETA</span>
                        <div className="font-mono font-medium">{new Date((shipment as any).etaPort).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                      </div>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* Exporter + buyer */}
                  <div className="flex-[2] min-w-[120px]">
                    <div className="text-[15px] truncate">{shipment.exporterName || '—'}</div>
                    <div className="text-[13px] text-muted-foreground truncate mt-0.5">
                      {shipment.buyerName || '—'}
                    </div>
                  </div>

                  {/* Doc + ticket counts */}
                  <div className="min-w-[64px] flex-[0.6] text-right hidden md:block">
                    {(shipment._count?.documents ?? 0) > 0 && (
                      <div className="text-[13px]">
                        <span className="font-mono">{shipment._count.documents}</span>
                        <span className="text-muted-foreground ml-1">docs</span>
                      </div>
                    )}
                    {(shipment._count?.tickets ?? 0) > 0 && (
                      <div className="text-[13px] mt-0.5">
                        <span className="font-mono">{shipment._count.tickets}</span>
                        <span className="text-muted-foreground ml-1">tickets</span>
                      </div>
                    )}
                  </div>

                  {/* Date */}
                  <div className="min-w-[56px] flex-[0.5] text-right">
                    <div className="text-[13px] text-muted-foreground font-mono">
                      {new Date(shipment.createdAt).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </div>
                  </div>
                </a>
              );
            })}

            {/* Empty state */}
            {filteredShipments.length === 0 && (
              <div className="rounded-lg p-12 text-center">
                <Ship className="w-10 h-10 mx-auto text-muted-foreground/40" />
                <h3 className="text-sm font-semibold mt-3">No shipments found</h3>
                <p className="text-[13px] text-muted-foreground mt-1">
                  {search
                    ? 'Try adjusting your search or filters'
                    : 'Create your first shipment to get started'}
                </p>
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

