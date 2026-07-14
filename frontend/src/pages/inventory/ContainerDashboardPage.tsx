import React, { useState, useEffect, useMemo } from 'react';
import {
  Navigation, Anchor, Clock, DollarSign, Search,
  Box, RefreshCw, AlertTriangle, Wifi, WifiOff, Settings,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

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
  const teal = 'hsl(173 58% 39%)';
  const muted = 'hsl(var(--muted-foreground))';
  const mutedBg = 'hsl(var(--muted))';

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* 7-node progress strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {STAGES.map((label, i) => {
          const done = i < stage;
          const active = i === stage;
          const isLast = i === STAGES.length - 1;

          return (
            <React.Fragment key={label}>
              <div title={label} style={{
                width: active ? 14 : 10,
                height: active ? 14 : 10,
                borderRadius: '50%',
                flexShrink: 0,
                background: done ? teal : active ? teal : mutedBg,
                boxShadow: active ? `0 0 0 3px hsla(173,58%,39%,0.18)` : 'none',
                transition: 'all 150ms',
              }} />
              {!isLast && (
                <div style={{
                  flex: 1,
                  height: 2,
                  background: done ? teal : mutedBg,
                  transition: 'background 150ms',
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Stage label row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {STAGES.map((label, i) => (
          <span key={label} style={{
            fontSize: 14.5,
            color: i === stage ? teal : muted,
            fontWeight: i === stage ? 600 : 400,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 80,
          }}>{label}</span>
        ))}
      </div>

      {/* Last event sublabel */}
      {(lastEventText || lastEventFacility) && (
        <div style={{
          fontSize: 14.5, color: muted, marginTop: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {lastEventFacility
            ? <>{lastEventFacility}{lastEventText ? ` · ${lastEventText}` : ''}</>
            : lastEventText}
          {lastEventAt && <span style={{ marginLeft: 4, opacity: 0.7 }}>· {formatTimeAgo(lastEventAt)}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Schedule status chip ─────────────────────────────────────────────────────

function ScheduleChip({ scheduleStatus, delayDays }: { scheduleStatus: string | null; delayDays: number | null }) {
  if (delayDays != null && delayDays > 0) {
    return (
      <span style={{
        fontSize: 14.5, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
        background: 'hsl(38 92% 93%)', color: 'hsl(38 55% 38%)',
        border: '1px solid hsl(38 80% 80%)', whiteSpace: 'nowrap',
      }}>
        +{delayDays}d
      </span>
    );
  }
  const s = (scheduleStatus || '').toLowerCase();
  if (s.includes('on') || s.includes('time') || delayDays === 0) {
    return (
      <span style={{
        fontSize: 14.5, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
        background: 'hsl(143 60% 93%)', color: 'hsl(143 50% 32%)',
        border: '1px solid hsl(143 50% 78%)', whiteSpace: 'nowrap',
      }}>
        On Time
      </span>
    );
  }
  return null;
}

// ─── StatPill ────────────────────────────────────────────────────────────────

type StatColor = 'blue' | 'amber' | 'red' | 'muted' | 'teal' | 'purple' | 'green';
const STAT_COLORS: Record<StatColor, { bg: string; text: string }> = {
  blue:   { bg: 'hsl(214 100% 97%)', text: 'hsl(214 72% 40%)' },
  amber:  { bg: 'hsl(38 92% 96%)',   text: 'hsl(38 55% 40%)' },
  red:    { bg: 'hsl(0 72% 97%)',    text: 'hsl(0 60% 45%)' },
  teal:   { bg: 'hsl(173 58% 95%)',  text: 'hsl(173 58% 30%)' },
  purple: { bg: 'hsl(270 60% 97%)',  text: 'hsl(270 50% 45%)' },
  green:  { bg: 'hsl(143 60% 96%)',  text: 'hsl(143 50% 32%)' },
  muted:  { bg: 'hsl(var(--muted))', text: 'hsl(var(--muted-foreground))' },
};

function StatPill({ label, value, color, icon: Icon, suffix = '', settingsLink }: {
  label: string; value: number; color: StatColor; icon: any; suffix?: string;
  settingsLink?: string;
}) {
  const { bg, text } = STAT_COLORS[color] || STAT_COLORS.muted;
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{ background: bg, borderRadius: 12, padding: '12px 14px', position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon style={{ width: 15, height: 15, color: text, opacity: 0.6 }} />
        <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: text }}>{value}</span>
        {suffix && <span style={{ fontSize: 14.5, fontFamily: 'monospace', color: text }}>{suffix}</span>}
        {settingsLink && hovered && (
          <a
            href={settingsLink}
            title="Configure thresholds in Settings"
            onClick={(e) => e.stopPropagation()}
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center',
              color: text, opacity: 0.6,
            }}
          >
            <Settings style={{ width: 11, height: 11 }} />
          </a>
        )}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 500, marginTop: 3, color: text, opacity: 0.75 }}>{label}</div>
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

  const borderColor =
    alertState === 'accruing'    ? 'hsl(0 72% 50%)' :
    alertState === 'approaching' ? 'hsl(38 92% 50%)' :
    alertState === 'stale'       ? 'hsl(220 9% 65%)' :
    'transparent';
  const rowBg =
    alertState === 'accruing'    ? 'hsla(0,72%,50%,0.04)' :
    alertState === 'approaching' ? 'hsla(38,92%,50%,0.04)' :
    'hsl(var(--card))';

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
        <span style={{ fontSize: 14, fontFamily: 'monospace', color: 'hsl(0 60% 45%)', fontWeight: 600 }}>
          {charge.currency} {Number(charge.totalCharge).toLocaleString()}
          <span style={{ fontSize: 14.5, color: 'hsl(0 50% 55%)', marginLeft: 4 }}>({daysPast}d past LFD)</span>
        </span>
      );
    } else if (daysUntil <= 0) {
      lfdNode = <span style={{ fontSize: 14, fontFamily: 'monospace', color: 'hsl(0 60% 45%)', fontWeight: 600 }}>LFD today</span>;
    } else {
      const color = alertState === 'approaching' ? 'hsl(38 55% 40%)' : 'hsl(var(--muted-foreground))';
      lfdNode = (
        <span style={{ fontSize: 14, fontFamily: 'monospace', color, fontWeight: alertState === 'approaching' ? 600 : 400 }}>
          LFD {daysUntil}d
          <span style={{ fontSize: 14.5, marginLeft: 4, opacity: 0.75 }}>({formatDate(charge.lfd)})</span>
        </span>
      );
    }
  }

  const vesselDisplay = container.scVesselName || container.vesselName;

  return (
    <a
      href={`/inventory/containers/${container.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: rowBg,
        borderRadius: 10,
        padding: '11px 14px',
        borderLeft: `3px solid ${borderColor}`,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'box-shadow 150ms',
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px hsla(0,0%,0%,0.08)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
    >
      {/* Container # + shipment ref */}
      <div style={{ width: 140, flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '-0.01em' }}>
          {container.containerNumber}
        </div>
        <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
          {container.shipment?.shipmentNumber || 'Pending ID'}
          {sc?.isoCode && (
            <span style={{ marginLeft: 5, opacity: 0.6 }}>{sc.isoCode}</span>
          )}
        </div>
      </div>

      {/* Journey strip — 7 nodes */}
      <JourneyStrip
        stage={stage}
        lastEventText={sc?.lastEvent?.description ?? null}
        lastEventFacility={sc?.lastEvent?.facilityName ?? sc?.lastEvent?.locationName ?? null}
        lastEventAt={sc?.lastEvent?.eventAt ?? container.lastEventAt ?? null}
      />

      {/* Vessel + ETA */}
      <div style={{ width: 120, flexShrink: 0, textAlign: 'right' }}>
        {vesselDisplay && (
          <div style={{
            fontSize: 14, fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {vesselDisplay}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 }}>
          {eta ? (
            <span style={{ fontSize: 14.5, fontFamily: 'monospace', color: 'hsl(var(--muted-foreground))' }}>
              ETA {formatDate(eta)}
            </span>
          ) : (
            <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>—</span>
          )}
          <ScheduleChip scheduleStatus={container.scheduleStatus} delayDays={container.delayDays} />
        </div>
      </div>

      {/* LFD / D&D */}
      <div style={{ width: 164, flexShrink: 0, textAlign: 'right' }}>
        {lfdNode ?? <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>—</span>}
      </div>

      {/* Alert icon */}
      <div style={{ width: 18, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
        {alertState === 'accruing'    && <DollarSign size={14} style={{ color: 'hsl(0 60% 45%)' }} />}
        {alertState === 'approaching' && <Clock size={14} style={{ color: 'hsl(38 55% 40%)' }} />}
        {alertState === 'stale'       && <WifiOff size={14} style={{ color: 'hsl(220 9% 55%)' }} />}
      </div>
    </a>
  );
}

// ─── SafeCube connection badge ────────────────────────────────────────────────

function ScBadge({ containers }: { containers: any[] }) {
  const linked = containers.filter(c => c.sc !== null).length;
  const total = containers.length;
  if (total === 0) return null;

  const allLinked = linked === total;
  const noneLinked = linked === 0;
  const someLinked = !allLinked && !noneLinked;

  const bg = noneLinked ? 'hsl(var(--muted))' : allLinked ? 'hsl(173 58% 95%)' : 'hsl(38 92% 96%)';
  const color = noneLinked ? 'hsl(var(--muted-foreground))' : allLinked ? 'hsl(173 58% 30%)' : 'hsl(38 55% 38%)';
  const label = noneLinked ? 'Live tracking unlinked' : allLinked ? 'Live tracking' : `${linked}/${total} live tracked`;
  const icon = noneLinked ? <WifiOff size={11} /> : allLinked ? <Wifi size={11} /> : <AlertTriangle size={11} />;

  const inner = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', borderRadius: 8, fontSize: 14.5,
      background: bg, color,
      textDecoration: 'none',
    }}>
      {icon}
      <span style={{ fontWeight: 600 }}>{label}</span>
      {(noneLinked || someLinked) && (
        <span style={{ fontSize: 14.5, opacity: 0.75 }}>· Connect in Settings</span>
      )}
    </div>
  );

  if (noneLinked || someLinked) {
    return (
      <a href="/settings" title="Configure SafeCube in Settings → Vessel Tracking" style={{ textDecoration: 'none' }}>
        {inner}
      </a>
    );
  }
  return inner;
}

// ─── Column header ────────────────────────────────────────────────────────────

function ColHeader({ children, width, align = 'left' }: { children: React.ReactNode; width?: number; align?: 'left' | 'right' }) {
  return (
    <div style={{
      width, flexShrink: 0,
      fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
      color: 'hsl(var(--muted-foreground))',
      textAlign: align,
    }}>
      {children}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

type InventoryViewMode = 'container' | 'breakBulk';

function BreakBulkEmptyState() {
  return (
    <div style={{
      border: '1px solid hsl(var(--border))',
      borderRadius: 8,
      background: 'hsl(var(--card))',
      padding: '44px 24px',
      textAlign: 'center',
      color: 'hsl(var(--muted-foreground))',
    }}>
      <Box size={24} style={{ margin: '0 auto 12px', opacity: 0.55 }} />
      <div style={{ fontSize: 16, fontWeight: 650, color: 'hsl(var(--foreground))', marginBottom: 4 }}>
        No break bulk inventory yet
      </div>
      <div style={{ fontSize: 14.5 }}>
        Break bulk tracking data will appear here once it is available.
      </div>
    </div>
  );
}

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

  const selectStyle: React.CSSProperties = {
    fontSize: 14.5, border: '1px solid hsl(var(--border))',
    borderRadius: 8, padding: '6px 10px',
    background: 'hsl(var(--background))', color: 'hsl(var(--foreground))',
    outline: 'none', cursor: 'pointer',
  };

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
          <div
            style={{
              display: 'flex',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              overflow: 'hidden',
              background: 'hsl(var(--background))',
            }}
          >
            <button
              onClick={() => setViewMode('container')}
              style={{
                padding: '6px 12px',
                border: 0,
                background: viewMode === 'container' ? 'hsl(173 58% 39%)' : 'transparent',
                color: viewMode === 'container' ? '#fff' : 'hsl(var(--foreground))',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Container
            </button>
            <button
              onClick={() => setViewMode('breakBulk')}
              style={{
                padding: '6px 12px',
                border: 0,
                borderLeft: '1px solid hsl(var(--border))',
                background: viewMode === 'breakBulk' ? 'hsl(173 58% 39%)' : 'transparent',
                color: viewMode === 'breakBulk' ? '#fff' : 'hsl(var(--foreground))',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Break Bulk
            </button>
          </div>
          {viewMode === 'container' && (
            <>
              <ScBadge containers={containers} />
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 8, border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--card))', fontSize: 14, cursor: refreshing ? 'not-allowed' : 'pointer',
                  opacity: refreshing ? 0.6 : 1,
                }}
              >
                <RefreshCw size={12} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
                Refresh
              </button>
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            width: 12, height: 12, color: 'hsl(var(--muted-foreground))',
          }} />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search containers, shipments, vessels…"
            style={{
              width: '100%', paddingLeft: 30, paddingRight: 10, paddingTop: 7, paddingBottom: 7,
              border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 14.5,
              background: 'hsl(var(--background))', color: 'hsl(var(--foreground))', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="all">All statuses</option>
          {filterOptions.statuses.map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>

        <select value={portFilter} onChange={e => setPortFilter(e.target.value)} style={selectStyle}>
          <option value="all">All ports</option>
          {filterOptions.ports.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)} style={selectStyle}>
          <option value="all">All risk levels</option>
          <option value="accruing">D&D Accruing</option>
          <option value="approaching">LFD Approaching</option>
          <option value="stale">Stale tracking</option>
          <option value="safe">Safe</option>
        </select>

        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} style={selectStyle}>
          <option value="risk">Sort: Risk</option>
          <option value="eta">Sort: ETA</option>
          <option value="default">Sort: Default</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'hsl(var(--muted-foreground))', fontSize: 14.5 }}>
          Loading containers…
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', marginBottom: 6 }}>
            <ColHeader width={140}>Container</ColHeader>
            <div style={{ flex: 1 }} />
            <ColHeader width={120} align="right">Vessel / ETA</ColHeader>
            <ColHeader width={164} align="right">LFD / D&D</ColHeader>
            <ColHeader width={20}>{null}</ColHeader>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredContainers.map(c => (
              <ContainerRow key={c.id} container={c} alertLookup={alertLookup} />
            ))}
            {filteredContainers.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'hsl(var(--muted-foreground))', fontSize: 14.5 }}>
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
