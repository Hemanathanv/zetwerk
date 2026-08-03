import React, { useState, useEffect, useMemo } from 'react';
import {
  Navigation, Anchor, Clock, DollarSign, Search,
  Box, RefreshCw, AlertTriangle, Wifi, WifiOff, Settings,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ListCell, ListHeaderRow, ListRow } from '@/components/ewms/DataDisplay';
import { SegmentedControl } from '@/components/ewms/SegmentedControl';
import { IconBadge, StepperHorizontal, type StepStatus } from '@/components/ewms/Visualization';
import { MetricCard } from '@/components/vs/MetricCard';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function formatTimeAgo(d: string | Date | null | undefined): string {
  if (!d) return '';
  const diffMs = Date.now() - new Date(d).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Journey stage derivation ─────────────────────────────────────────────────

const STAGES = ['Origin', 'Vessel Loaded', 'Ocean', 'US Port', 'Gate Out', 'At 3PL', 'Delivered'] as const;
type StageIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Maps InventoryMovement.movementType values to JourneyStrip stage indices.
 * movementType is the primary source; currentStatus and SafeCube events are fallbacks.
 */
const MOVEMENT_TYPE_TO_STAGE: Record<string, StageIndex> = {
  PORT_ARRIVAL:    3,
  GATE_OUT:        4,
  THREE_PL_INWARD: 5,
  THREE_PL_TRANSFER: 5,
  DELIVERY:        6,
  EMPTY_RETURN:    6,
};

function deriveStage(
  movementType: string | null,
  scStatus: string | null,
  ewmsStatus: string | null,
  eventCode: string | null,
): StageIndex {
  // Primary: use latest InventoryMovement.movementType
  if (movementType && MOVEMENT_TYPE_TO_STAGE[movementType] !== undefined) {
    return MOVEMENT_TYPE_TO_STAGE[movementType];
  }

  // Secondary: container currentStatus (set by backend from movement events)
  const cs = (ewmsStatus || '').toLowerCase();
  if (cs === 'delivered' || cs === 'returned') return 6;
  if (cs === 'in_warehouse') return 5;
  if (cs === 'gate_out') return 4;
  if (cs === 'at_port' || cs === 'discharged') return 3;
  if (cs === 'in_transit') return 2;
  if (cs === 'vessel_loaded') return 1;
  if (cs === 'at_origin') return 0;

  // Fallback: regex on SafeCube status + eventCode
  const s = ((scStatus || '') + ' ' + (eventCode || '')).toLowerCase();
  if (s.match(/deliver|empty.ret|return/)) return 6;
  if (s.match(/warehouse|inward|3pl/)) return 5;
  if (s.match(/gate.out/)) return 4;
  if (s.match(/discharg|at.port|arrival|pod/)) return 3;
  if (s.match(/transit|sea|ocean|vessel.dep|depart/)) return 2;
  if (s.match(/loaded|load.*vessel|vessel.load|stuff|vessel.arr.*origin|lofu/)) return 1;
  return 0;
}

function JourneyStrip({ stage, lastEventText, lastEventFacility, lastEventAt }: {
  stage: StageIndex;
  lastEventText: string | null;
  lastEventFacility: string | null;
  lastEventAt: string | null;
}) {
  const steps = STAGES.map((label, i) => ({
    label,
    status: (i < stage ? 'completed' : i === stage ? 'active' : 'upcoming') as StepStatus,
  }));

  return (
    <div className="min-w-0 flex-1">
      <StepperHorizontal steps={steps} />
      {(lastEventText || lastEventFacility) && (
        <div className="mt-1 truncate text-sm text-muted-foreground">
          {lastEventFacility
            ? <>{lastEventFacility}{lastEventText ? ` - ${lastEventText}` : ''}</>
            : lastEventText}
          {lastEventAt && <span className="ml-1 opacity-70">- {formatTimeAgo(lastEventAt)}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Schedule status chip ─────────────────────────────────────────────────────

function ScheduleChip({ scheduleStatus, delayDays }: { scheduleStatus: string | null; delayDays: number | null }) {
  if (delayDays != null && delayDays > 0) {
    return <Badge intent="warning" size="sm">+{delayDays}d</Badge>;
  }
  const s = (scheduleStatus || '').toLowerCase();
  if (s.includes('on') || s.includes('time') || delayDays === 0) {
    return <Badge intent="success" size="sm">On Time</Badge>;
  }
  return null;
}

// ─── StatPill ────────────────────────────────────────────────────────────────

type StatColor = 'blue' | 'amber' | 'red' | 'muted' | 'teal' | 'purple' | 'green';
const STAT_TONE: Record<StatColor, 'info' | 'warning' | 'danger' | 'teal' | 'green'> = {
  blue: 'info',
  amber: 'warning',
  red: 'danger',
  teal: 'teal',
  purple: 'info',
  green: 'green',
  muted: 'info',
};

function StatPill({ label, value, color, icon: Icon, suffix = '', settingsLink }: {
  label: string; value: number; color: StatColor; icon: any; suffix?: string;
  settingsLink?: string;
}) {
  return (
    <div className="relative">
      <MetricCard
        label={label}
        value={suffix ? `${value}${suffix}` : value}
        icon={null}
        color={STAT_TONE[color] ?? 'info'}
        href={settingsLink}
      />
      {settingsLink && (
        <Settings className="pointer-events-none absolute right-3 top-3 size-3 text-muted-foreground opacity-60" aria-hidden="true" />
      )}
    </div>
  );
}

// ─── ContainerRow ────────────────────────────────────────────────────────────

function ContainerRow({ container, alertLookup }: {
  container: any;
  alertLookup: Record<string, number>;
}) {
  const now = Date.now();
  const charge = container.dndCharge;
  const sc = container.sc;
  const approachingMs = alertLookup['dnd_approaching'] || 3 * 86400000;
  const staleMs = alertLookup['stale_tracking'] || 48 * 3600000;

  type AlertState = 'none' | 'approaching' | 'accruing' | 'stale';
  let alertState: AlertState = 'none';
  if (charge?.status === 'ACCRUING') {
    alertState = 'accruing';
  } else if (charge?.lfd) {
    const lfdTime = new Date(charge.lfd).getTime();
    if (lfdTime > now && (lfdTime - now) <= approachingMs) alertState = 'approaching';
  }
  if (alertState === 'none' && container.lastEventAt) {
    const lastEvTime = new Date(container.lastEventAt).getTime();
    if ((now - lastEvTime) > staleMs && ['at_origin', 'in_transit'].includes(container.currentStatus || '')) {
      alertState = 'stale';
    }
  }

  const stage = deriveStage(
    container.latestMovementType ?? null,
    sc?.status ?? null,
    container.currentStatus,
    sc?.lastEvent?.eventCode ?? null,
  );
  const eta = container.podPredictiveEta || container.etaPort;

  let lfdNode: React.ReactNode = null;
  if (charge?.lfd) {
    const lfdTime = new Date(charge.lfd).getTime();
    const daysUntil = Math.ceil((lfdTime - now) / 86400000);
    if (charge.status === 'ACCRUING') {
      const daysPast = Math.floor((now - lfdTime) / 86400000);
      lfdNode = (
        <span className="text-sm font-semibold tabular-nums text-destructive">
          {charge.currency} {Number(charge.totalCharge).toLocaleString()}
          <span className="ml-1 text-xs">({daysPast}d past LFD)</span>
        </span>
      );
    } else if (daysUntil <= 0) {
      lfdNode = <Badge intent="danger" size="sm">LFD today</Badge>;
    } else {
      lfdNode = (
        <span className={alertState === 'approaching' ? 'text-sm font-semibold tabular-nums text-[hsl(var(--vs-warning))]' : 'text-sm tabular-nums text-muted-foreground'}>
          LFD {daysUntil}d
          <span className="ml-1 text-xs opacity-75">({formatDate(charge.lfd)})</span>
        </span>
      );
    }
  }

  const vesselDisplay = container.scVesselName || container.vesselName;

  return (
    <ListRow
      onClick={() => { window.location.href = `/inventory/containers/${container.id}`; }}
      className={alertState === 'accruing' ? 'border-l-4 border-l-destructive' : alertState === 'approaching' ? 'border-l-4 border-l-[hsl(var(--vs-warning))]' : alertState === 'stale' ? 'border-l-4 border-l-muted-foreground' : 'border-l-4 border-l-transparent'}
      style={{ gridTemplateColumns: '140px minmax(360px,1fr) 120px 164px 20px' } as React.CSSProperties}
    >
      <ListCell
        primary={<span className="font-semibold tabular-nums">{container.containerNumber}</span>}
        secondary={<>
          {container.shipment?.shipmentNumber || 'Pending ID'}
          {sc?.isoCode && <span className="ml-1 opacity-70">{sc.isoCode}</span>}
        </>}
      />

      <JourneyStrip
        stage={stage}
        lastEventText={sc?.lastEvent?.description ?? null}
        lastEventFacility={sc?.lastEvent?.facilityName ?? sc?.lastEvent?.locationName ?? null}
        lastEventAt={sc?.lastEvent?.eventAt ?? container.lastEventAt ?? null}
      />

      <ListCell
        kind="date"
        primary={vesselDisplay || '-'}
        secondary={
          <span className="flex items-center justify-end gap-1">
            {eta ? <span>ETA {formatDate(eta)}</span> : <span>-</span>}
            <ScheduleChip scheduleStatus={container.scheduleStatus} delayDays={container.delayDays} />
          </span>
        }
      />

      <ListCell kind="metric" metric={lfdNode ?? <span className="text-muted-foreground">-</span>} />

      <div className="flex justify-center">
        {alertState === 'accruing' && <DollarSign className="size-4 text-destructive" aria-label="D&D accruing" />}
        {alertState === 'approaching' && <Clock className="size-4 text-[hsl(var(--vs-warning))]" aria-label="LFD approaching" />}
        {alertState === 'stale' && <WifiOff className="size-4 text-muted-foreground" aria-label="Stale tracking" />}
      </div>
    </ListRow>
  );
}

function ScBadge({ containers }: { containers: any[] }) {
  const linked = containers.filter(c => c.sc !== null).length;
  const total = containers.length;
  if (total === 0) return null;

  const allLinked = linked === total;
  const noneLinked = linked === 0;
  const someLinked = !allLinked && !noneLinked;

  const label = noneLinked ? 'Live tracking unlinked' : allLinked ? 'Live tracking' : `${linked}/${total} live tracked`;
  const Icon = noneLinked ? WifiOff : allLinked ? Wifi : AlertTriangle;
  const intent = noneLinked ? 'neutral' : allLinked ? 'active' : 'warning';

  const inner = (
    <IconBadge
      icon={Icon}
      intent={intent}
      label={<>
        {label}
        {(noneLinked || someLinked) && <span className="opacity-75">- Connect in Settings</span>}
      </>}
    />
  );

  if (noneLinked || someLinked) {
    return <a href="/settings" title="Configure SafeCube in Settings - Vessel Tracking" className="no-underline">{inner}</a>;
  }

  return inner;
}

type InventoryViewMode = 'container' | 'breakBulk';
export function ContainerDashboardPage() {
  const { user } = useAuth();
  const roleCategory = (user?.role as any)?.category;
  const isAdmin = roleCategory === 'org_admin' || roleCategory === 'ADMIN';

  const [viewMode, setViewMode] = useState<InventoryViewMode>('container');
  const [containers, setContainers] = useState<any[]>([]);
  const [alertThresholds, setAlertThresholds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [statusFilter, setStatusFilter] = useState('all');
  const [portFilter, setPortFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'default' | 'eta' | 'risk'>('risk');
  const [searchQuery, setSearchQuery] = useState('');

  function loadData() {
    return Promise.all([
      fetch('/api/tracking/containers/all', { headers: authHeaders() }).then(r => r.json()),
      fetch('/api/admin/inventory/alerts', { headers: authHeaders() }).then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([ctnRes, alertRes]) => {
      setContainers(ctnRes.data || []);
      setAlertThresholds(alertRes.data || []);
    });
  }

  useEffect(() => { loadData().finally(() => setLoading(false)); }, []);

  function handleRefresh() {
    setRefreshing(true);
    loadData().finally(() => setRefreshing(false));
  }

  const alertLookup = useMemo(() => {
    const lookup: Record<string, number> = {};
    for (const alert of alertThresholds) {
      lookup[alert.alertType] = alert.thresholdValue * (alert.thresholdUnit === 'days' ? 86400000 : 3600000);
    }
    return lookup;
  }, [alertThresholds]);

  const filterOptions = useMemo(() => {
    const ports = [...new Set(containers.map(c => c.currentLocation).filter(Boolean))] as string[];
    const statuses = [...new Set(containers.map(c => c.currentStatus).filter(Boolean))] as string[];
    return { ports, statuses };
  }, [containers]);

  const summaryStats = useMemo(() => {
    const now = Date.now();
    const approachingThreshold = alertLookup['dnd_approaching'] || 3 * 86400000;
    // atPort: containers whose latest movement type is PORT_ARRIVAL, or currentStatus fallback
    // at3PL:  containers whose latest movement type is THREE_PL_INWARD/TRANSFER, or currentStatus fallback
    const hasMovement = (c: any, types: string[]) =>
      c.latestMovementType && types.includes(c.latestMovementType);
    return {
      atOrigin:      containers.filter(c => ['at_origin', 'vessel_loaded'].includes(c.currentStatus || '')).length,
      inTransit:     containers.filter(c => c.currentStatus === 'in_transit').length,
      atPort:        containers.filter(c =>
        hasMovement(c, ['PORT_ARRIVAL']) ||
        (!c.latestMovementType && ['at_port', 'discharged'].includes(c.currentStatus || ''))
      ).length,
      gateOut:       containers.filter(c =>
        hasMovement(c, ['GATE_OUT']) ||
        (!c.latestMovementType && c.currentStatus === 'gate_out')
      ).length,
      at3PL:         containers.filter(c =>
        hasMovement(c, ['THREE_PL_INWARD', 'THREE_PL_TRANSFER']) ||
        (!c.latestMovementType && c.currentStatus === 'in_warehouse')
      ).length,
      approaching:   containers.filter(c => {
        if (!c.dndCharge?.lfd) return false;
        const t = new Date(c.dndCharge.lfd).getTime();
        return t > now && (t - now) <= approachingThreshold;
      }).length,
      accruing:      containers.filter(c => c.dndCharge?.status === 'ACCRUING').length,
      totalCharge:   containers.reduce((s, c) =>
        s + (c.dndCharge?.status === 'ACCRUING' ? Number(c.dndCharge.totalCharge || 0) : 0), 0),
    };
  }, [containers, alertLookup]);

  const filteredContainers = useMemo(() => {
    const now = Date.now();
    const approachingThreshold = alertLookup['dnd_approaching'] || 3 * 86400000;
    const staleThreshold = alertLookup['stale_tracking'] || 48 * 3600000;

    let result = [...containers];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.containerNumber.toLowerCase().includes(q) ||
        (c.scVesselName || c.vesselName || '').toLowerCase().includes(q) ||
        (c.shipment?.shipmentNumber || '').toLowerCase().includes(q) ||
        (c.currentLocation || '').toLowerCase().includes(q) ||
        (c.sc?.lastEvent?.facilityName || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') result = result.filter(c => c.currentStatus === statusFilter);
    if (portFilter !== 'all') result = result.filter(c => c.currentLocation === portFilter);
    if (riskFilter !== 'all') {
      result = result.filter(c => {
        const charge = c.dndCharge;
        const lastEvMs = c.lastEventAt ? new Date(c.lastEventAt).getTime() : 0;
        switch (riskFilter) {
          case 'approaching': return charge?.lfd &&
            new Date(charge.lfd).getTime() > now &&
            (new Date(charge.lfd).getTime() - now) <= approachingThreshold;
          case 'accruing': return charge?.status === 'ACCRUING';
          case 'stale': return lastEvMs > 0 && (now - lastEvMs) > staleThreshold;
          case 'safe': return !charge || charge.status === 'MONITORING';
          default: return true;
        }
      });
    }

    if (sortBy === 'eta') {
      result.sort((a, b) => {
        const aEta = (a.podPredictiveEta || a.etaPort) ? new Date(a.podPredictiveEta || a.etaPort).getTime() : Infinity;
        const bEta = (b.podPredictiveEta || b.etaPort) ? new Date(b.podPredictiveEta || b.etaPort).getTime() : Infinity;
        return aEta - bEta;
      });
    } else if (sortBy === 'risk') {
      const riskScore = (c: any) => {
        if (c.dndCharge?.status === 'ACCRUING') return 0;
        const lfd = c.dndCharge?.lfd ? new Date(c.dndCharge.lfd).getTime() : null;
        if (lfd && lfd > now && (lfd - now) <= approachingThreshold) return 1;
        return 2;
      };
      result.sort((a, b) => riskScore(a) - riskScore(b));
    }

    return result;
  }, [containers, searchQuery, statusFilter, portFilter, riskFilter, sortBy, alertLookup]);

  return (
    <div style={{ padding: '24px 32px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{
            fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)',
            letterSpacing: '-0.025em', margin: 0, color: 'hsl(var(--foreground))', lineHeight: 1.2,
          }}>
            Inventory Tracking
          </h1>
          <p style={{ fontSize: 'var(--text-subtitle-size)', color: 'hsl(var(--muted-foreground))', margin: '4px 0 0' }}>
            {viewMode === 'container'
              ? `${containers.length} mapped container${containers.length !== 1 ? 's' : ''} from approved BOL mappings`
              : 'Break bulk inventory tracking'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SegmentedControl
            value={viewMode}
            onValueChange={(value) => setViewMode(value as InventoryViewMode)}
            options={[
              { value: 'container', label: 'Container' },
              { value: 'breakBulk', label: 'Break Bulk' },
            ]}
          />
          {viewMode === 'container' && (
            <>
              <ScBadge containers={containers} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
                className="gap-2"
              >
                <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
                Refresh
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary stats — 7 pills */}
      {viewMode === 'breakBulk' ? (
        <BreakBulkEmptyState />
      ) : (
        <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 16 }}>
        <StatPill label="At Origin / Loading" value={summaryStats.atOrigin}    color="muted"  icon={Box} />
        <StatPill label="Ocean Transit"        value={summaryStats.inTransit}   color="blue"   icon={Navigation} />
        <StatPill label="At US Port"           value={summaryStats.atPort}      color="teal"   icon={Anchor} />
        <StatPill label="Gate Out / Transit"   value={summaryStats.gateOut}     color="purple" icon={Navigation} />
        <StatPill label="At 3PL Warehouse"     value={summaryStats.at3PL}       color="green"  icon={WarehouseIcon} />
        <StatPill
          label="LFD Approaching"
          value={summaryStats.approaching}
          color={summaryStats.approaching > 0 ? 'amber' : 'muted'}
          icon={Clock}
          settingsLink={isAdmin ? '/settings' : undefined}
        />
        <StatPill
          label="D&D Accruing"
          value={summaryStats.accruing}
          color={summaryStats.accruing > 0 ? 'red' : 'muted'}
          icon={DollarSign}
          suffix={summaryStats.totalCharge > 0 ? ` ($${Math.round(summaryStats.totalCharge / 1000)}k)` : ''}
          settingsLink={isAdmin ? '/settings' : undefined}
        />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search containers, shipments, vessels..."
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {filterOptions.statuses.map(s => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={portFilter} onValueChange={setPortFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All ports" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ports</SelectItem>
            {filterOptions.ports.map(p => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={riskFilter} onValueChange={setRiskFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All risk levels" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All risk levels</SelectItem>
            <SelectItem value="accruing">D&amp;D Accruing</SelectItem>
            <SelectItem value="approaching">LFD Approaching</SelectItem>
            <SelectItem value="stale">Stale tracking</SelectItem>
            <SelectItem value="safe">Safe</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Sort" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="risk">Sort: Risk</SelectItem>
            <SelectItem value="eta">Sort: ETA</SelectItem>
            <SelectItem value="default">Sort: Default</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Loading containers...
        </div>
      ) : (
        <>
          <ListHeaderRow
            className="mb-1 rounded-t-lg"
            style={{ gridTemplateColumns: '140px minmax(360px,1fr) 120px 164px 20px' } as React.CSSProperties}
          >
            <span>Container</span>
            <span>Journey</span>
            <span className="text-right">Vessel / ETA</span>
            <span className="text-right">LFD / D&D</span>
            <span />
          </ListHeaderRow>

          <div className="flex flex-col gap-1.5">
            {filteredContainers.map(c => (
              <ContainerRow key={c.id} container={c} alertLookup={alertLookup} />
            ))}
            {filteredContainers.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No containers match these filters.
              </div>
            )}
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
}
