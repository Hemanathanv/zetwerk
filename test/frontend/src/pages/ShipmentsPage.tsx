import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Search, X, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill, FilterChips } from '@/components/vs';
import { ALERT_PILL, PHASE_LABELS, type StageVariant } from '@/data/mockShipments';
import { getAuthToken, readJsonResponse } from '@/lib/api';
import { BACKEND_API_BASE } from '@/lib/apiBase';
import { ScheduleStatusBadge } from '@/components/SafeCubePanel';
import { usePageMeta } from '@/contexts/PageMetaContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShipmentListRow {
  realId: string;
  id: string;
  mbl: string;
  buyer: string;
  vessel: string;
  route: string;
  stage: string;
  stageVariant: StageVariant;
  listStatus: 'in_progress' | 'hold' | 'cancelled' | 'closed';
  journeyPhase: number;
  loadMode: string | null;
  incoterm: string | null;
  docsComplete: number;
  docsTotal: number;
  docNote: string;
  docDanger: boolean;
  etaPort: string;
  etaDate: string;
  etaDays: string;
  alert: { text: string; variant: 'danger' | 'warning' } | null;
  value: string;
  updatedMinsAgo: number;
  projectCode: string | null;
  hasAlert: boolean;
  // SafeCube live tracking enrichment
  safecubeLinked: boolean;
  safecubeEtaAt: string | null;
  safecubeScheduleStatus: string | null;
  safecubeDelayDays: number | null;
  safecubeCurrentLocation: string | null;
  safecubeAlertCount: number;
}

type SortKey = 'id' | 'vessel' | 'projectCode' | 'status' | 'stage' | 'loadMode' | 'docs' | 'eta' | 'alerts';
type SortDir = 'asc' | 'desc';
const PAGE_SIZE = 20;

type ShipmentsQueryData = {
  rows: ShipmentListRow[];
  total: number;
  fetchedAt: Date;
};

// Responsive type scale — grows/shrinks with viewport width instead of one fixed compact size
const FS_HEADER    = 'clamp(10.5px, 0.78vw, 12.5px)';
const FS_PRIMARY   = 'clamp(12px, 0.95vw, 14px)';
const FS_SECONDARY = 'clamp(11px, 0.85vw, 12.5px)';
const FS_BADGE      = 'clamp(11px, 0.8vw, 12.5px)';

const COLUMNS: { label: string; key: SortKey }[] = [
  { label: 'Shipment ID / MBL', key: 'id'        },
  { label: 'Vessel · Route',  key: 'vessel'       },
  { label: 'Project',         key: 'projectCode'  },
  { label: 'Status',          key: 'status'       },
  { label: 'Stage · Phase',   key: 'stage'        },
  { label: 'Load / Incoterm', key: 'loadMode'     },
  { label: 'Documents',       key: 'docs'         },
  { label: 'ETA',             key: 'eta'          },
  { label: 'Alerts',          key: 'alerts'       },
];

// ─── Map real API shipment → display row ─────────────────────────────────────

function stageVariantFromName(name: string, isBlocked: boolean): StageVariant {
  if (isBlocked) return 'blocked';
  const n = name.toLowerCase();
  if (n.includes('transit') || n.includes('voyage') || n.includes('departed')) return 'transit';
  if (n.includes('port') || n.includes('arriv') || n.includes('discharg') || n.includes('at us')) return 'port';
  if (n.includes('clear') || n.includes('customs') || n.includes('trucking') || n.includes('delivery')) return 'cleared';
  if (n.includes('complete') || n.includes('delivered')) return 'validated';
  if (n.includes('book') || n.includes('india') || n.includes('pre-')) return 'info';
  return 'pending';
}

function normalizeListStatus(value: unknown): ShipmentListRow['listStatus'] {
  const status = String(value ?? '').toLowerCase();
  if (status === 'hold' || status === 'on_hold' || status === 'held') return 'hold';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (status === 'closed') return 'closed';
  return 'in_progress';
}

function shipmentStatusMeta(status: ShipmentListRow['listStatus']) {
  const map: Record<ShipmentListRow['listStatus'], { label: string; color: string; bg: string; border: string }> = {
    in_progress: { label: 'In progress', color: '#0f766e', bg: 'rgba(13,148,136,0.10)', border: 'rgba(13,148,136,0.25)' },
    hold:        { label: 'Hold',        color: '#b45309', bg: 'rgba(217,119,6,0.12)',  border: 'rgba(217,119,6,0.28)' },
    cancelled:   { label: 'Cancelled',   color: '#dc2626', bg: 'rgba(220,38,38,0.10)',  border: 'rgba(220,38,38,0.25)' },
    closed:      { label: 'Closed',      color: '#166534', bg: 'rgba(22,101,52,0.10)',  border: 'rgba(22,101,52,0.25)' },
  };
  return map[status];
}

function mapApiShipment(s: any): ShipmentListRow {
  const gates = [...(s.shipmentGates ?? [])].sort(
    (a: any, b: any) => (a.gateConfig?.gateNumber ?? 999) - (b.gateConfig?.gateNumber ?? 999)
  );
  const activeGate  = gates.find((g: any) => g.status === 'ACTIVE' || g.status === 'OPEN');
  const blockedGate = gates.find((g: any) => g.status === 'BLOCKED');
  const passedCount = gates.filter((g: any) => g.status === 'PASSED').length;
  const totalGates  = gates.length;
  const isBlocked   = !!blockedGate;

  // Journey phase 1-6
  const journeyPhase = totalGates > 0
    ? Math.min(6, Math.max(1, Math.round((passedCount / totalGates) * 5) + 1))
    : 1;

  const currentGate = activeGate ?? blockedGate;
  const stageName = currentGate?.gateConfig?.gateName
    ?? (passedCount === totalGates && totalGates > 0 ? 'Complete' : 'Pending');
  const stageVariant = stageVariantFromName(stageName, isBlocked);
  const listStatus = normalizeListStatus(s.listStatus ?? s.shipmentListStatus ?? s.status);

  // Docs
  const docs = s.documents ?? [];
  const countData = s._count ?? {};
  const docsTotalFromCount = Number(countData.documents ?? s.documentsTotal);
  const docsApprovedFromCount = Number(countData.documentsApproved ?? s.documentsApproved);
  const isApprovedDoc = (d: any) => Boolean(d.approvedAt)
    || String(d.status ?? '').toUpperCase() === 'REVIEWED'
    || String(d.ocrStatus ?? '').toUpperCase() === 'REVIEWED';
  const docsComplete = Number.isFinite(docsApprovedFromCount)
    ? docsApprovedFromCount
    : docs.filter(isApprovedDoc).length;
  const docsTotal = Number.isFinite(docsTotalFromCount)
    ? docsTotalFromCount
    : docs.length;
  const pendingCount = docs.filter((d: any) => !isApprovedDoc(d) && d.ocrStatus && String(d.ocrStatus).toLowerCase() !== 'pending').length;
  let docNote = '';
  if (docsTotal === 0)            docNote = 'No documents';
  else if (docsComplete === docsTotal) docNote = 'All docs approved';
  else if (pendingCount > 0)      docNote = `${pendingCount} pending review`;
  else                            docNote = `${docsTotal - docsComplete} awaiting`;

  // ETA — SafeCube takes priority over ContainerTracking
  const safecubeEtaDate = s.safecubeEtaAt ? new Date(s.safecubeEtaAt) : null;
  const etaPortDate     = s.etaPort     ? new Date(s.etaPort)     : null;
  const etaDeliveryDate = s.etaDelivery ? new Date(s.etaDelivery) : null;
  const etaDate         = safecubeEtaDate ?? etaPortDate ?? etaDeliveryDate;
  const daysUntil       = etaDate ? Math.ceil((etaDate.getTime() - Date.now()) / 86_400_000) : null;
  const etaDays =
    daysUntil === null   ? '' :
    daysUntil < -1       ? `${Math.abs(daysUntil)}d past` :
    daysUntil === 0      ? 'Today' :
    daysUntil === 1      ? 'Tomorrow' :
    `${daysUntil} days`;
  const etaFmt   = etaDate ? etaDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const portName = s.portOfDischarge ?? (etaDate ? 'US port' : '—');

  // Alert
  let alert: ShipmentListRow['alert'] = null;
  if (isBlocked) {
    alert = { text: 'Blocked', variant: 'danger' };
  } else if (s.shipmentTags?.some((t: any) => t.tagType === 'DND_ACCRUING')) {
    alert = { text: 'LFD soon', variant: 'danger' };
  } else if (daysUntil !== null && daysUntil <= 2 && daysUntil >= 0 && etaDate) {
    alert = { text: `ETA ${daysUntil}d`, variant: 'warning' };
  }

  // Load type
  const lt = (s.loadType ?? '').toLowerCase();
  const loadMode = lt === 'fcl' ? 'FCL' : lt === 'lcl' ? 'LCL' : lt === 'break_bulk' ? null : (s.loadType ?? null);

  const updatedMinsAgo = s.updatedAt
    ? Math.floor((Date.now() - new Date(s.updatedAt).getTime()) / 60_000)
    : 0;

  return {
    realId:      s.id,
    id:          s.shipmentNumber ?? s.id,
    mbl:         s.mblNumber ?? s.shipmentNumber ?? '—',
    buyer:       s.buyerName ?? s.exporterName ?? '—',
    vessel:      s.vesselName ?? 'TBD',
    route:       [s.portOfLoading, s.portOfDischarge].filter(Boolean).join(' → ') || '—',
    stage:       stageName,
    stageVariant,
    listStatus,
    journeyPhase,
    loadMode,
    incoterm:    s.incoterms ?? null,
    docsComplete,
    docsTotal,
    docNote,
    docDanger:   isBlocked,
    etaPort:     portName,
    etaDate:     etaFmt,
    etaDays,
    alert,
    value:       '—',
    updatedMinsAgo,
    projectCode: s.project?.projectCode ?? s.projectName ?? null,
    hasAlert:    alert !== null,
    safecubeLinked:          s.safecubeLinked          ?? false,
    safecubeEtaAt:           s.safecubeEtaAt           ?? null,
    safecubeScheduleStatus:  s.safecubeScheduleStatus  ?? null,
    safecubeDelayDays:       s.safecubeDelayDays       ?? null,
    safecubeCurrentLocation: s.safecubeCurrentLocation ?? null,
    safecubeAlertCount:      s.safecubeAlertCount      ?? 0,
  };
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

function etaSortVal(row: ShipmentListRow): number {
  if (!row.etaDate) return Infinity;
  const now = new Date();
  const d   = new Date(`${row.etaDate} ${now.getFullYear()}`);
  if (isNaN(d.getTime())) return Infinity;
  if (d.getMonth() < now.getMonth() - 6) d.setFullYear(now.getFullYear() + 1);
  return d.getTime();
}

function alertSortVal(row: ShipmentListRow): number {
  if (!row.alert) return 2;
  return row.alert.variant === 'danger' ? 0 : 1;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PhaseDots({
  current,
  layout = 'row',
}: {
  current: number;
  layout?: 'row' | 'column';
}) {
  const isColumn = layout === 'column';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isColumn ? 'column' : 'row',
        alignItems: isColumn ? 'flex-start' : 'center',
        gap: isColumn ? 4 : 3,
        marginTop: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div
            key={n}
            title={PHASE_LABELS[n]}
            style={{
              width: n === current ? 12 : 6,
              height: 6,
              borderRadius: 999,
              backgroundColor: n <= current ? 'hsl(var(--primary))' : 'hsl(220 14% 88%)',
              opacity: n < current ? 0.45 : 1,
              transition: 'width 0.15s',
            }}
          />
        ))}
      </div>
      <span
        style={{
          fontSize: FS_SECONDARY,
          color: 'hsl(var(--muted-foreground))',
          fontFamily: 'var(--app-font-sans)',
          marginLeft: isColumn ? 0 : 3,
        }}
      >
        {PHASE_LABELS[current]}
      </span>
    </div>
  );
}

function SortIcon({ colKey, sortKey, sortDir }: { colKey: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  const active = colKey === sortKey;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', marginLeft: 4, verticalAlign: 'middle', gap: 0 }}>
      <ChevronUp  style={{ width: 10, height: 10, display: 'block', color: active && sortDir === 'asc'  ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.35)', marginBottom: -2 }} />
      <ChevronDown style={{ width: 10, height: 10, display: 'block', color: active && sortDir === 'desc' ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.35)' }} />
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ShipmentsPage() {
  const [, navigate] = useLocation();
  const { setPageMeta } = usePageMeta();

  const [page,    setPage]    = useState(1);

  const [activeChip,     setActiveChip]     = useState(0);
  const [projectFilter,  setProjectFilter]  = useState('All Projects');
  const [search,         setSearch]         = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortKey,        setSortKey]        = useState<SortKey>('eta');
  const [sortDir,        setSortDir]        = useState<SortDir>('asc');

  const urlPhase = (() => {
    const p = new URLSearchParams(window.location.search).get('phase');
    return p ? parseInt(p, 10) : null;
  })();
  const [phaseFilter, setPhaseFilter] = useState<number | null>(urlPhase);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const shipmentsQuery = useQuery<ShipmentsQueryData>({
    queryKey: ['shipments', 'list', 'v2', page, debouncedSearch],
    queryFn: async () => {
      const token = getAuthToken();
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      const requestPath = `/api/shipments?${params.toString()}`;
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      let res: Response;
      try {
        res = await fetch(requestPath, { headers });
      } catch (error) {
        if (!BACKEND_API_BASE) throw error;
        res = await fetch(`${BACKEND_API_BASE}${requestPath}`, { headers });
      }
      const json = await readJsonResponse<any>(res);
      if (!json.ok) throw new Error(json.error ?? 'Failed to load');
      const mapped: ShipmentListRow[] = (json.data ?? []).map(mapApiShipment);
      return {
        rows: mapped,
        total: json.meta?.total ?? mapped.length,
        fetchedAt: new Date(),
      };
    },
    placeholderData: previousData => previousData,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = shipmentsQuery.data?.rows ?? [];
  const total = shipmentsQuery.data?.total ?? rows.length;
  const lastFetch = shipmentsQuery.data?.fetchedAt ?? null;
  const loading = shipmentsQuery.isLoading;
  const error = shipmentsQuery.error instanceof Error ? shipmentsQuery.error.message : null;

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    const handleModuleSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; value: string }>).detail;
      if (detail.scope !== 'shipments' && detail.scope !== 'all') return;
      setPage(1);
      setSearch(detail.value);
    };
    window.addEventListener('ewms-module-search', handleModuleSearch);
    return () => window.removeEventListener('ewms-module-search', handleModuleSearch);
  }, []);

  // ── Derived filter counts ──────────────────────────────────────────────────
  const filterChips = useMemo(() => [
    { label: 'All',           count: rows.length },
    { label: 'In India',      count: rows.filter(r => r.journeyPhase <= 2).length },
    { label: 'Ocean transit', count: rows.filter(r => r.journeyPhase === 3).length },
    { label: 'US customs',    count: rows.filter(r => r.journeyPhase === 4 || r.journeyPhase === 5).length },
    { label: 'US delivery',   count: rows.filter(r => r.journeyPhase === 6).length },
    { label: 'Alerts',        count: rows.filter(r => r.hasAlert).length },
  ], [rows]);

  const projectOptions = useMemo(
    () => ['All Projects', ...new Set(rows.map(r => r.projectCode).filter((v): v is string => Boolean(v)))],
    [rows]
  );

  // ── Sort + filter ──────────────────────────────────────────────────────────
  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const filtered = useMemo(() => {
    const base = rows.filter(r => {
      // Chip filter
      if (activeChip === 1 && r.journeyPhase > 2)          return false;
      if (activeChip === 2 && r.journeyPhase !== 3)         return false;
      if (activeChip === 3 && r.journeyPhase !== 4 && r.journeyPhase !== 5) return false;
      if (activeChip === 4 && r.journeyPhase !== 6)         return false;
      if (activeChip === 5 && !r.hasAlert)                  return false;
      // Project filter
      if (projectFilter !== 'All Projects' && r.projectCode !== projectFilter) return false;
      // Phase banner filter (from Dashboard)
      if (phaseFilter !== null && r.journeyPhase !== phaseFilter) return false;
      // Search
      if (search) {
        const q = search.toLowerCase();
        return r.id.toLowerCase().includes(q)  ||
               r.mbl.toLowerCase().includes(q) ||
               r.vessel.toLowerCase().includes(q) ||
               r.buyer.toLowerCase().includes(q);
      }
      return true;
    });

    return [...base].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'id':          cmp = a.id.localeCompare(b.id); break;
        case 'vessel':      cmp = a.vessel.localeCompare(b.vessel); break;
        case 'projectCode': cmp = (a.projectCode ?? '').localeCompare(b.projectCode ?? ''); break;
        case 'status':      cmp = a.listStatus.localeCompare(b.listStatus); break;
        case 'stage':       cmp = a.journeyPhase - b.journeyPhase; break;
        case 'loadMode':    cmp = (a.loadMode ?? '').localeCompare(b.loadMode ?? ''); break;
        case 'docs':        cmp = (a.docsTotal > 0 ? a.docsComplete / a.docsTotal : 0) - (b.docsTotal > 0 ? b.docsComplete / b.docsTotal : 0); break;
        case 'eta':         cmp = etaSortVal(a) - etaSortVal(b); break;
        case 'alerts':      cmp = alertSortVal(a) - alertSortVal(b); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, activeChip, projectFilter, phaseFilter, search, sortKey, sortDir]);

  const shipmentSearchOptions = useMemo(
    () => search.trim() ? filtered.slice(0, 8) : [],
    [filtered, search],
  );

  // ── Subtitle ───────────────────────────────────────────────────────────────
  const subtitle = (() => {
    const active = total || rows.filter(r => r.stageVariant !== 'blocked').length;
    const mins   = lastFetch ? Math.floor((Date.now() - lastFetch.getTime()) / 60_000) : null;
    const ago    = mins === null ? '' : mins === 0 ? ' · updated just now' : ` · updated ${mins}m ago`;
    return `India → US export corridor · ${active} active shipments${ago}`;
  })();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingEnd = Math.min(page * PAGE_SIZE, total);

  useEffect(() => {
    setPageMeta({ title: 'Shipments', subtitle });
    return () => setPageMeta(null);
  }, [subtitle, setPageMeta]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="px-6 pb-6 h-full flex flex-col">
      <div className="flex items-center justify-end gap-2 mb-4 flex-none">
        <Button variant="outline" size="sm" onClick={() => shipmentsQuery.refetch()} disabled={loading} className="flex items-center gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button variant="outline" size="sm">Export CSV</Button>
      </div>

      {/* Phase filter banner (from Dashboard funnel) */}
      {phaseFilter !== null && (
        <div className="flex-none" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, marginBottom: 10, background: 'hsl(var(--primary) / 0.07)', border: '1px solid hsl(var(--primary) / 0.2)' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'hsl(var(--primary))' }}>
            Filtered by phase: <strong>{PHASE_LABELS[phaseFilter]}</strong>
          </span>
          <button onClick={() => setPhaseFilter(null)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}>
            <X style={{ width: 11, height: 11 }} />
            Clear
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex-none" style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 10, background: 'hsl(0 84% 60% / 0.08)', border: '1px solid hsl(0 84% 60% / 0.2)', fontSize: 13, color: 'hsl(0 84% 45%)' }}>
          Failed to load shipments: {error} —{' '}
          <button onClick={() => shipmentsQuery.refetch()} style={{ textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 'inherit' }}>retry</button>
        </div>
      )}

      {/* Filters + search */}
      <div className="flex items-center flex-wrap gap-2 mb-4 flex-none">
        <FilterChips chips={filterChips} activeIndex={activeChip} onSelect={setActiveChip} />
        <select
          value={projectFilter}
          onChange={e => setProjectFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-full text-[12px] font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors border-0 focus:outline-none"
        >
          {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="relative ml-auto" style={{ maxWidth: 280, flex: '1 1 200px', zIndex: 5 }}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" style={{ width: 13, height: 13 }} />
          <Input
            value={search}
            onChange={e => { setPage(1); setSearch(e.target.value); }}
            placeholder="Search shipments..."
            className="pl-8 h-8 focus-visible:ring-1"
            style={{ fontSize: 13 }}
          />
          {shipmentSearchOptions.length > 0 && (
            <div style={{
              position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)',
              background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
              borderRadius: 8, boxShadow: '0 10px 28px hsla(0,0%,0%,0.16)', overflow: 'hidden',
            }}>
              {shipmentSearchOptions.map(s => (
                <button
                  key={s.realId}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => navigate(`/shipments/${s.realId}`)}
                  style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', padding: '8px 10px', textAlign: 'left', display: 'block' }}
                >
                  <div className="data-mono-id" style={{ color: 'hsl(var(--foreground))' }}>{s.id}</div>
                  <div style={{ fontSize: 11.5, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>{s.vessel} · {s.mbl || 'No MBL'}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-lg flex-1 min-h-0" style={{ boxShadow: 'var(--vs-shadow-card)' }}>
        <table className="w-full bg-card" style={{ minWidth: 820, tableLayout: 'fixed', borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: '15%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%'  }} />
          </colgroup>
          <thead>
            <tr style={{ backgroundColor: 'hsl(var(--background))', borderBottom: '1px solid hsl(var(--border))' }}>
              {COLUMNS.map(({ label, key }) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: 'hsl(var(--background))', textAlign: 'left', padding: '10px 8px', fontSize: FS_HEADER, textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600, color: sortKey === key ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))', whiteSpace: 'normal', cursor: 'pointer', userSelect: 'none' }}
                >
                  {label}
                  <SortIcon colKey={key} sortKey={sortKey} sortDir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid hsl(220 14% 95%)' }}>
                  {COLUMNS.map((c) => (
                    <td key={c.key} style={{ padding: 12 }}>
                      <div style={{ height: 12, borderRadius: 6, background: 'hsl(var(--muted))', width: '70%', animation: 'pulse 1.5s ease-in-out infinite' }} />
                      <div style={{ height: 9, borderRadius: 6, background: 'hsl(var(--muted))', width: '45%', marginTop: 5, animation: 'pulse 1.5s ease-in-out infinite', opacity: 0.6 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: 36, textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 13 }}>
                  {rows.length === 0 ? 'No shipments found.' : 'No shipments match your filters.'}
                </td>
              </tr>
            ) : filtered.map((s, idx) => (
              <tr
                key={s.realId}
                onClick={() => navigate(`/shipments/${s.realId}`)}
                style={{ borderBottom: idx < filtered.length - 1 ? '1px solid hsl(220 14% 95%)' : 'none', cursor: 'pointer', verticalAlign: 'top', transition: 'background 0.12s ease' }}
                onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'hsl(var(--background))'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = ''; }}
              >
                {/* Shipment ID */}
                <td style={{ padding: 10 }}>
                  <div className="data-mono-id" style={{ color: 'hsl(var(--primary))' }}>{s.id}</div>
                  <div className="data-mono-id" style={{ color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>MBL: {s.mbl}</div>
                </td>

                {/* Vessel / Route */}
                <td style={{ padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div className="data-route-text">{s.vessel}</div>
                    {s.safecubeLinked && (
                      <span title="Live tracking active" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 12, height: 12, borderRadius: 6, backgroundColor: 'hsl(var(--vs-teal) / 0.15)', color: 'hsl(var(--vs-teal))' }}>
                        <span style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: 'hsl(var(--vs-teal))', display: 'block' }} />
                      </span>
                    )}
                  </div>
                  <div className="data-route-text" style={{ color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>
                    {s.safecubeCurrentLocation ?? s.route}
                  </div>
                </td>

                {/* Project */}
                <td style={{ padding: 12 }}>
                  <div className="data-mono-id" style={{ color: 'hsl(var(--foreground))' }}>{s.projectCode || '—'}</div>
                </td>

                {/* Status */}
                <td style={{ padding: 10 }}>
                  {(() => {
                    const meta = shipmentStatusMeta(s.listStatus);
                    return (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '3px 9px',
                        borderRadius: 999,
                        fontSize: FS_BADGE,
                        fontWeight: 600,
                        color: meta.color,
                        background: meta.bg,
                        border: `1px solid ${meta.border}`,
                        whiteSpace: 'nowrap',
                      }}>
                        {meta.label}
                      </span>
                    );
                  })()}
                </td>

                {/* Stage + phase dots */}
                <td style={{ padding: 12 }}>
                  <StatusPill status={s.stage} variant={s.stageVariant} />
                  <PhaseDots current={s.journeyPhase} layout='column' />
                </td>

                {/* Load mode / Incoterm */}
                <td style={{ padding: 12 }}>
                  {s.loadMode ? (
                    <span className="vs-mono" style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 6, fontSize: FS_BADGE, fontWeight: 600, background: 'hsl(var(--primary) / 0.08)', color: 'hsl(var(--primary))', border: '1px solid hsl(var(--primary) / 0.2)' }}>
                      {s.loadMode}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12.5, color: 'hsl(var(--muted-foreground))' }}>Break-bulk</span>
                  )}
                  {s.incoterm && (
                    <div className="vs-mono" style={{ fontSize: FS_SECONDARY, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{s.incoterm}</div>
                  )}
                </td>

                {/* Documents */}
                <td style={{ padding: 12 }}>
                  <div className="data-metric-value" style={{ color: 'hsl(var(--foreground))' }}>
                    {s.docsComplete}/{s.docsTotal}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 3, color: s.docDanger ? 'hsl(var(--vs-danger))' : 'hsl(var(--muted-foreground))' }}>{s.docNote}</div>
                </td>

                {/* ETA */}
                <td style={{ padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                      {s.etaDate ? `${s.etaPort} · ${s.etaDate}` : '—'}
                    </div>
                    {s.safecubeLinked && s.safecubeScheduleStatus && (
                      <ScheduleStatusBadge status={s.safecubeScheduleStatus} delayDays={s.safecubeDelayDays} />
                    )}
                  </div>
                  <div className="data-elapsed-time" style={{ color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{s.etaDays}</div>
                </td>

                {/* Alerts */}
                <td style={{ padding: 12 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    {s.alert && (
                      <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: FS_BADGE, fontWeight: 500, backgroundColor: ALERT_PILL[s.alert.variant].bg, color: ALERT_PILL[s.alert.variant].color, whiteSpace: 'nowrap' }}>
                        {s.alert.text}
                      </span>
                    )}
                    {s.safecubeAlertCount > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 999, fontSize: FS_BADGE, fontWeight: 600, backgroundColor: 'hsl(var(--vs-danger) / 0.12)', color: 'hsl(var(--vs-danger))', whiteSpace: 'nowrap' }}>
                        ⚠ {s.safecubeAlertCount} vessel
                      </span>
                    )}
                    {!s.alert && s.safecubeAlertCount === 0 && (
                      <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: FS_BADGE }}>—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex-none" style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
        <span>
          {loading && rows.length > 0
            ? 'Refreshing...'
            : `Showing ${showingStart}-${showingEnd} of ${total} shipments`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="flex items-center gap-1.5"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Prev
          </Button>
          <span style={{ fontSize: 14 }}>Page {page} of {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="flex items-center gap-1.5"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
