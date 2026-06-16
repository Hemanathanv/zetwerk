import { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Search, Plus, X, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill, FilterChips, ProgressBar, PageHeader } from '@/components/vs';
import { MOCK_SHIPMENTS, ALERT_PILL, PHASE_LABELS, PROJECTS, type ShipmentRow } from '@/data/mockShipments';

const FILTER_CHIPS = [
  { label: 'All',           count: 47 },
  { label: 'In India',      count: 11 },
  { label: 'Ocean transit', count: 14 },
  { label: 'US customs',    count: 8  },
  { label: 'US delivery',   count: 6  },
  { label: 'Alerts',        count: 5  },
];

type SortKey = 'id' | 'vessel' | 'projectName' | 'stage' | 'loadMode' | 'docs' | 'eta' | 'alerts' | 'value';
type SortDir = 'asc' | 'desc';

const COLUMNS: { label: string; key: SortKey }[] = [
  { label: 'Shipment / BOL', key: 'id' },
  { label: 'Vessel Â· Route', key: 'vessel' },
  { label: 'Project',        key: 'projectName' },
  { label: 'Stage Â· Phase',  key: 'stage' },
  { label: 'Load / Incoterm', key: 'loadMode' },
  { label: 'Documents',      key: 'docs' },
  { label: 'ETA',            key: 'eta' },
  { label: 'Alerts',         key: 'alerts' },
  { label: 'Value',          key: 'value' },
];

function etaSortValue(etaDate: string): number {
  if (!etaDate) return Infinity;
  const now = new Date();
  const currentMonth = now.getMonth();
  const candidate = new Date(`${etaDate} ${now.getFullYear()}`);
  if (isNaN(candidate.getTime())) return Infinity;
  if (candidate.getMonth() < currentMonth - 6) {
    candidate.setFullYear(now.getFullYear() + 1);
  }
  return candidate.getTime();
}

function valueSortValue(value: string): number {
  const match = value.replace(/[^0-9.]/g, '');
  const num = parseFloat(match);
  if (value.toUpperCase().includes('K')) return num * 1_000;
  if (value.toUpperCase().includes('M')) return num * 1_000_000;
  return isNaN(num) ? 0 : num;
}

function alertSortValue(alert: { text: string; variant: string } | null): number {
  if (!alert) return 2;
  if (alert.variant === 'danger') return 0;
  if (alert.variant === 'warning') return 1;
  return 2;
}

function projectNameForShipment(shipment: ShipmentRow): string {
  return PROJECTS.find((project) => project.id === shipment.projectId)?.projectName ?? '';
}

function PhaseDots({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 5 }}>
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <div
          key={n}
          title={PHASE_LABELS[n]}
          style={{
            width: n === current ? 14 : 7,
            height: 7,
            borderRadius: 999,
            backgroundColor: n < current
              ? 'hsl(var(--primary))'
              : n === current
              ? 'hsl(var(--primary))'
              : 'hsl(220 14% 88%)',
            opacity: n < current ? 0.45 : 1,
            transition: 'width 0.15s',
          }}
        />
      ))}
      <span style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginLeft: 3, fontFamily: 'JetBrains Mono, monospace' }}>
        {PHASE_LABELS[current]}
      </span>
    </div>
  );
}

function SortIcon({ colKey, sortKey, sortDir }: { colKey: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  const active = colKey === sortKey;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', marginLeft: 4, verticalAlign: 'middle', gap: 0 }}>
      <ChevronUp
        style={{
          width: 10,
          height: 10,
          display: 'block',
          color: active && sortDir === 'asc' ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.35)',
          marginBottom: -2,
        }}
      />
      <ChevronDown
        style={{
          width: 10,
          height: 10,
          display: 'block',
          color: active && sortDir === 'desc' ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.35)',
        }}
      />
    </span>
  );
}

export function ShipmentsPage() {
  const [, navigate] = useLocation();
  const [activeChip, setActiveChip] = useState(0);
  const [projectFilter, setProjectFilter] = useState('All Projects');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('eta');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const urlPhase = (() => {
    const p = new URLSearchParams(window.location.search).get('phase');
    return p ? parseInt(p, 10) : null;
  })();
  const [phaseFilter, setPhaseFilter] = useState<number | null>(urlPhase);
  const projectOptions = useMemo(
    () => ['All Projects', ...new Set(MOCK_SHIPMENTS.map(projectNameForShipment).filter(Boolean))],
    []
  );

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const filtered = useMemo(() => {
    const base = MOCK_SHIPMENTS.filter((s) => {
      if (projectFilter !== 'All Projects' && projectNameForShipment(s) !== projectFilter) return false;
      if (phaseFilter !== null && s.journeyPhase !== phaseFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        s.id.toLowerCase().includes(q) ||
        s.bol.toLowerCase().includes(q) ||
        s.vessel.toLowerCase().includes(q) ||
        s.buyer.toLowerCase().includes(q)
      );
    });

    return [...base].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'id':
          cmp = a.id.localeCompare(b.id);
          break;
        case 'vessel':
          cmp = a.vessel.localeCompare(b.vessel);
          break;
        case 'projectName':
          cmp = projectNameForShipment(a).localeCompare(projectNameForShipment(b));
          break;
        case 'stage':
          cmp = a.journeyPhase - b.journeyPhase;
          break;
        case 'loadMode':
          cmp = (a.loadMode ?? '').localeCompare(b.loadMode ?? '');
          if (cmp === 0) cmp = (a.incoterm ?? '').localeCompare(b.incoterm ?? '');
          break;
        case 'docs':
          cmp = (a.docsComplete / a.docsTotal) - (b.docsComplete / b.docsTotal);
          break;
        case 'eta':
          cmp = etaSortValue(a.etaDate) - etaSortValue(b.etaDate);
          break;
        case 'alerts':
          cmp = alertSortValue(a.alert) - alertSortValue(b.alert);
          break;
        case 'value':
          cmp = valueSortValue(a.value) - valueSortValue(b.value);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [projectFilter, phaseFilter, search, sortKey, sortDir]);

  return (
    <div className="p-7">

      <PageHeader
        title="Shipments"
        subtitle="India â†’ US export corridor Â· 47 active shipments Â· updated 2 min ago"
        actions={
          <>
            <Button variant="outline" size="sm">Export CSV</Button>
            <Button
              size="sm"
              className="text-white flex items-center gap-1.5"
              style={{ backgroundColor: 'hsl(var(--primary))' }}
              onClick={() => navigate('/shipments/new')}
            >
              <Plus className="w-3.5 h-3.5" />
              New shipment
            </Button>
          </>
        }
      />

      {/* Phase filter banner (shown when arriving from Dashboard funnel) */}
      {phaseFilter !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            borderRadius: 8,
            marginBottom: 12,
            background: 'hsl(var(--primary) / 0.07)',
            border: '1px solid hsl(var(--primary) / 0.2)',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 500, color: 'hsl(var(--primary))' }}>
            Filtered by phase: <strong>{PHASE_LABELS[phaseFilter]}</strong>
          </span>
          <button
            onClick={() => setPhaseFilter(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 500,
              color: 'hsl(var(--muted-foreground))',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            <X style={{ width: 12, height: 12 }} />
            Clear
          </button>
        </div>
      )}

      {/* Filters + search */}
      <div className="flex items-center flex-wrap gap-2 mb-4">
        <FilterChips chips={FILTER_CHIPS} activeIndex={activeChip} onSelect={setActiveChip} />
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="px-3 py-2 rounded-full text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors border-0 focus:outline-none"
        >
          {projectOptions.map((project) => (
            <option key={project} value={project}>{project}</option>
          ))}
        </select>
        <div className="relative ml-auto" style={{ maxWidth: 320, flex: '1 1 200px' }}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" style={{ width: 15, height: 15 }} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, BOL, vessel, buyerâ€¦"
            className="pl-9 focus-visible:ring-1"
            style={{ fontSize: 13 }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl" style={{ boxShadow: 'var(--vs-shadow-card)' }}>
        <table className="w-full bg-card" style={{ minWidth: 960, borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '6%'  }} />
            <col style={{ width: '4%'  }} />
          </colgroup>
          <thead>
            <tr style={{ backgroundColor: 'hsl(var(--background))', borderBottom: '1px solid hsl(var(--border))' }}>
              {COLUMNS.map(({ label, key }) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  style={{
                    textAlign: 'left',
                    padding: '13px 16px',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    fontWeight: 500,
                    color: sortKey === key ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {label}
                  <SortIcon colKey={key} sortKey={sortKey} sortDir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                  <td colSpan={9} style={{ padding: 40, textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 13 }}>
                  No shipments match your search.
                </td>
              </tr>
            )}
            {filtered.map((s, idx) => (
              <tr
                key={s.id}
                onClick={() => navigate(`/shipments/${s.id}`)}
                style={{
                  borderBottom: idx < filtered.length - 1 ? '1px solid hsl(220 14% 95%)' : 'none',
                  cursor: 'pointer',
                  verticalAlign: 'top',
                  transition: 'background 0.12s ease',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'hsl(var(--background))'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = ''; }}
              >
                {/* Shipment ID */}
                <td style={{ padding: 16 }}>
                  <div className="vs-mono font-semibold" style={{ fontSize: 13, color: 'hsl(var(--primary))' }}>
                    {s.id}
                  </div>
                  <div className="vs-mono" style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>
                    BOL: {s.bol}
                  </div>
                </td>

                {/* Vessel / Route */}
                <td style={{ padding: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{s.vessel}</div>
                  <div className="vs-mono" style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>
                    {s.route}
                  </div>
                </td>

                {/* Project */}
                <td style={{ padding: 16 }}>
                  <div style={{ fontSize: 13, color: 'hsl(var(--foreground))' }}>
                    {projectNameForShipment(s) || '—'}
                  </div>
                </td>

                {/* Stage + phase dots */}
                <td style={{ padding: 16 }}>
                  <StatusPill status={s.stage} variant={s.stageVariant} />
                  <PhaseDots current={s.journeyPhase} />
                </td>

                {/* Load mode / Incoterm */}
                <td style={{ padding: 16 }}>
                  {s.loadMode ? (
                    <span
                      className="vs-mono"
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        background: 'hsl(var(--primary) / 0.08)',
                        color: 'hsl(var(--primary))',
                        border: '1px solid hsl(var(--primary) / 0.2)',
                      }}
                    >
                      {s.loadMode}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>Break-bulk</span>
                  )}
                  {s.incoterm && (
                    <div className="vs-mono" style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                      {s.incoterm}
                    </div>
                  )}
                </td>

                {/* Documents */}
                <td style={{ padding: 16 }}>
                  <ProgressBar
                    current={s.docsComplete}
                    total={s.docsTotal}
                    variant={s.docDanger ? 'danger' : 'default'}
                  />
                  <div style={{ fontSize: 11, marginTop: 4, color: s.docDanger ? 'hsl(var(--vs-danger))' : 'hsl(var(--muted-foreground))' }}>
                    {s.docNote}
                  </div>
                </td>

                {/* ETA */}
                <td style={{ padding: 16 }}>
                  {s.etaPort !== 'â€”' ? (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{s.etaPort} Â· {s.etaDate}</div>
                      <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{s.etaDays}</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>â€”</div>
                      <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{s.etaDays}</div>
                    </>
                  )}
                </td>

                {/* Alerts */}
                <td style={{ padding: 16 }}>
                  {s.alert ? (
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 10px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 500,
                      backgroundColor: ALERT_PILL[s.alert.variant].bg,
                      color: ALERT_PILL[s.alert.variant].color,
                      whiteSpace: 'nowrap',
                    }}>
                      {s.alert.text}
                    </span>
                  ) : (
                    <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: 13 }}>â€”</span>
                  )}
                </td>

                {/* Value */}
                <td style={{ padding: 16 }}>
                  <span className="vs-mono font-semibold" style={{ fontSize: 13 }}>{s.value}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer count */}
      <div style={{ marginTop: 12, fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
        Showing {filtered.length} of {MOCK_SHIPMENTS.length} shipments
      </div>
    </div>
  );
}
