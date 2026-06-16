import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { PageHeader, SlaBar } from '@/components/vs';
import { getAuthToken } from '@/lib/api';

type SlaVariant = 'ok' | 'warning' | 'critical';
type UrgencyGroup = 'blocker' | 'warning' | 'inprogress';
type BadgeKind = 'BLOCKER' | 'ESCALATED' | '75% SLA' | 'ON TRACK';
type DocType = 'SI' | 'MC' | 'DD' | 'BL' | 'PL' | 'SB' | 'FF' | 'DR';
type TaskFilter = 'all' | 'by-shipment';

type TaskCard = {
  id: number;
  group: UrgencyGroup;
  docType: DocType;
  title: string;
  badge: BadgeKind;
  meta: { label: string; value: string }[];
  slaPercent: number;
  slaTime: string;
  slaVariant: SlaVariant;
  buttonLabel: string;
  buttonStyle: 'primary' | 'outline';
  shipmentId: string;
  isReport?: boolean;
};

const DOC_ICON_STYLES: Record<DocType, { bg: string; color: string }> = {
  SI: { bg: 'hsla(221,83%,53%,0.10)', color: 'hsl(221 83% 45%)' },
  MC: { bg: 'hsla(173,58%,39%,0.10)', color: 'hsl(var(--vs-teal-dark))' },
  DD: { bg: 'hsla(152,69%,31%,0.10)', color: 'hsl(152 69% 25%)' },
  BL: { bg: 'hsla(38,92%,50%,0.12)',  color: 'hsl(38 92% 35%)' },
  PL: { bg: 'hsla(221,83%,53%,0.10)', color: 'hsl(221 83% 45%)' },
  SB: { bg: 'hsla(38,92%,50%,0.12)',  color: 'hsl(38 92% 35%)' },
  FF: { bg: 'hsla(43,96%,56%,0.15)',  color: 'hsl(38 92% 30%)' },
  DR: { bg: 'hsla(43,96%,56%,0.15)',  color: 'hsl(38 92% 30%)' },
};

const BADGE_STYLES: Record<BadgeKind, { bg: string; color: string }> = {
  'BLOCKER':  { bg: 'hsla(0,84%,60%,0.12)',   color: 'hsl(0 84% 40%)' },
  'ESCALATED':{ bg: 'hsla(38,92%,50%,0.12)',  color: 'hsl(38 92% 35%)' },
  '75% SLA':  { bg: 'hsla(38,92%,50%,0.12)',  color: 'hsl(38 92% 35%)' },
  'ON TRACK': { bg: 'hsla(173,58%,39%,0.10)', color: 'hsl(var(--vs-teal-dark))' },
};

const GROUP_META: Record<UrgencyGroup, { label: string; dotColor: string }> = {
  blocker:    { label: 'BLOCKER — action required immediately', dotColor: 'hsl(var(--vs-danger))' },
  warning:    { label: 'WARNING — SLA approaching',             dotColor: 'hsl(var(--vs-warning))' },
  inprogress: { label: 'IN PROGRESS',                           dotColor: 'hsl(var(--vs-teal))' },
};

const MOCK_TASKS: TaskCard[] = [
  {
    id: 1, group: 'blocker', docType: 'MC',
    title: 'Resolve MCS weight mismatch', badge: 'BLOCKER',
    meta: [
      { label: 'Shipment', value: 'J44CES25090021' },
      { label: 'Invoice',  value: 'KA/UM/2526/00798' },
      { label: 'Validation', value: 'V-SSD-01' },
    ],
    slaPercent: 100, slaTime: '18h overdue', slaVariant: 'critical',
    buttonLabel: 'Review', buttonStyle: 'primary',
    shipmentId: 'J44CES25090021',
  },
  {
    id: 2, group: 'blocker', docType: 'SI',
    title: 'Upload sales invoice for new booking', badge: 'ESCALATED',
    meta: [
      { label: 'Shipment', value: 'J44CES25090024' },
      { label: 'Trigger',  value: 'Booking TBD-1127' },
      { label: 'ETD',      value: 'Nov 25' },
    ],
    slaPercent: 100, slaTime: '6h overdue', slaVariant: 'critical',
    buttonLabel: 'Upload', buttonStyle: 'primary',
    shipmentId: 'J44CES25090024',
  },
  {
    id: 3, group: 'warning', docType: 'DD',
    title: 'Generate deduction certificate (DDS)', badge: '75% SLA',
    meta: [
      { label: 'Shipment',  value: 'J44CES25090015' },
      { label: 'Invoices',  value: '6 clubbed' },
      { label: 'Draft',     value: 'Auto-generated' },
    ],
    slaPercent: 75, slaTime: '6 hours left', slaVariant: 'warning',
    buttonLabel: 'Review draft', buttonStyle: 'primary',
    shipmentId: 'J44CES25090015',
  },
  {
    id: 4, group: 'warning', docType: 'BL',
    title: 'Confirm draft BOL & send to forwarder', badge: '75% SLA',
    meta: [
      { label: 'Shipment',   value: 'BE-250888610007' },
      { label: 'Forwarder',  value: 'Benevlog' },
      { label: 'ETD',        value: 'Tomorrow' },
    ],
    slaPercent: 70, slaTime: '11 hours left', slaVariant: 'warning',
    buttonLabel: 'Review', buttonStyle: 'primary',
    shipmentId: 'BE-250888610007',
  },
  {
    id: 5, group: 'inprogress', docType: 'MC',
    title: 'Generate metal content sheet', badge: 'ON TRACK',
    meta: [
      { label: 'Shipment',   value: 'J44CES25090023' },
      { label: 'Invoice',    value: 'KA/UM/2526/00810' },
      { label: 'Source',     value: 'Auto-generated' },
    ],
    slaPercent: 30, slaTime: '1d 8h left', slaVariant: 'ok',
    buttonLabel: 'Review', buttonStyle: 'outline',
    shipmentId: 'J44CES25090023',
  },
  {
    id: 6, group: 'inprogress', docType: 'PL',
    title: 'Review auto-generated packing list', badge: 'ON TRACK',
    meta: [
      { label: 'Shipment', value: 'J44CES25090025' },
      { label: 'Source',   value: 'Sales invoice KA/UM/2526/00821' },
    ],
    slaPercent: 25, slaTime: '1d 14h left', slaVariant: 'ok',
    buttonLabel: 'Review', buttonStyle: 'outline',
    shipmentId: 'J44CES25090025',
  },
  {
    id: 7, group: 'inprogress', docType: 'SB',
    title: 'Upload shipping bill (from CHA)', badge: 'ON TRACK',
    meta: [
      { label: 'Shipment', value: 'BLRCH2526SI00139' },
      { label: 'CHA',      value: 'Benevlog' },
      { label: 'ETD',      value: 'Nov 30' },
    ],
    slaPercent: 18, slaTime: '2d 4h left', slaVariant: 'ok',
    buttonLabel: 'Upload', buttonStyle: 'outline',
    shipmentId: 'BLRCH2526SI00139',
  },
  {
    id: 8, group: 'inprogress', docType: 'FF',
    title: 'Review freight forwarder bill', badge: 'ON TRACK',
    meta: [
      { label: 'Shipment', value: 'J44CES25090019' },
      { label: 'FF bill',  value: 'INV44260100215' },
      { label: 'Uploaded', value: '2h ago' },
    ],
    slaPercent: 10, slaTime: '3d left', slaVariant: 'ok',
    buttonLabel: 'Review', buttonStyle: 'outline',
    shipmentId: 'J44CES25090019',
  },
  {
    id: 9, group: 'inprogress', docType: 'DR',
    title: 'Confirm daily shipment report', badge: 'ON TRACK',
    meta: [
      { label: 'Reference', value: 'DSR-2026-01-28' },
      { label: 'Summary',   value: '47 shipments · 5 alerts' },
    ],
    slaPercent: 15, slaTime: 'Today 6pm', slaVariant: 'ok',
    buttonLabel: 'Review', buttonStyle: 'outline',
    shipmentId: '',
    isReport: true,
  },
];

const GROUPS: UrgencyGroup[] = ['blocker', 'warning', 'inprogress'];

function GroupHeader({ group, isFirst }: { group: UrgencyGroup; isFirst: boolean }) {
  const { label, dotColor } = GROUP_META[group];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: isFirst ? 0 : 28,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          backgroundColor: dotColor,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'hsl(var(--muted-foreground))',
        }}
      >
        {label}
      </span>
    </div>
  );
}

function ShipmentGroupHeader({ shipmentId, count, isFirst }: { shipmentId: string; count: number; isFirst: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginTop: isFirst ? 0 : 28,
        marginBottom: 12,
        padding: '8px 12px',
        borderRadius: 8,
        backgroundColor: 'hsl(var(--muted) / 0.4)',
      }}
    >
      <span
        className="vs-mono font-semibold"
        style={{ fontSize: 12, color: 'hsl(var(--foreground))' }}
      >
        {shipmentId || 'No shipment'}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          padding: '1px 7px',
          borderRadius: 999,
          backgroundColor: 'hsl(var(--border))',
          color: 'hsl(var(--muted-foreground))',
        }}
      >
        {count} task{count !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

function TaskCardItem({ task, onClick }: { task: TaskCard; onClick: () => void }) {
  const iconStyle = DOC_ICON_STYLES[task.docType];
  const badgeStyle = BADGE_STYLES[task.badge];

  const borderLeft =
    task.group === 'blocker'
      ? '3px solid hsl(var(--vs-danger))'
      : task.group === 'warning'
      ? '3px solid hsl(var(--vs-warning))'
      : 'none';

  return (
    <div
      onClick={onClick}
      className="bg-card rounded-xl cursor-pointer"
      style={{
        padding: '18px 20px',
        marginBottom: 10,
        borderLeft,
        boxShadow: 'var(--vs-shadow-card)',
        transition: 'transform 0.12s ease, box-shadow 0.12s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--vs-shadow-elevated)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = '';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--vs-shadow-card)';
      }}
    >
      {/* Desktop: 4-column grid */}
      <div
        className="hidden lg:grid"
        style={{
          gridTemplateColumns: 'auto minmax(0,1fr) auto auto',
          gap: 16,
          alignItems: 'center',
        }}
      >
        {/* Col 1: Doc icon */}
        <div
          className="vs-mono font-bold flex items-center justify-center flex-shrink-0"
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            fontSize: 13,
            backgroundColor: iconStyle.bg,
            color: iconStyle.color,
          }}
        >
          {task.docType}
        </div>

        {/* Col 2: Content */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              {task.title}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 999,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                backgroundColor: badgeStyle.bg,
                color: badgeStyle.color,
                flexShrink: 0,
              }}
            >
              {task.badge}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
            {task.meta.map((m) => (
              <span key={m.label} style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
                {m.label}:{' '}
                <span className="vs-mono font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                  {m.value}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Col 3: SLA bar */}
        <div style={{ flexShrink: 0 }}>
          <SlaBar
            percentElapsed={task.slaPercent}
            timeRemaining={task.slaTime}
            variant={task.slaVariant}
          />
        </div>

        {/* Col 4: Action button */}
        <div style={{ flexShrink: 0 }}>
          {task.buttonStyle === 'primary' ? (
            <Button
              size="sm"
              className="text-white"
              style={{
                padding: '7px 14px',
                fontSize: 12,
                backgroundColor: 'hsl(var(--primary))',
              }}
              onClick={(e) => { e.stopPropagation(); onClick(); }}
            >
              {task.buttonLabel}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              style={{ padding: '7px 14px', fontSize: 12 }}
              onClick={(e) => { e.stopPropagation(); onClick(); }}
            >
              {task.buttonLabel}
            </Button>
          )}
        </div>
      </div>

      {/* Mobile: stacked layout */}
      <div className="flex flex-col gap-3 lg:hidden">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div
            className="vs-mono font-bold flex items-center justify-center flex-shrink-0"
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              fontSize: 12,
              backgroundColor: iconStyle.bg,
              color: iconStyle.color,
            }}
          >
            {task.docType}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
                {task.title}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 7px',
                  borderRadius: 999,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  backgroundColor: badgeStyle.bg,
                  color: badgeStyle.color,
                  flexShrink: 0,
                }}
              >
                {task.badge}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 12px' }}>
              {task.meta.map((m) => (
                <span key={m.label} style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
                  {m.label}:{' '}
                  <span className="vs-mono font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                    {m.value}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <SlaBar
            percentElapsed={task.slaPercent}
            timeRemaining={task.slaTime}
            variant={task.slaVariant}
          />
          {task.buttonStyle === 'primary' ? (
            <Button
              size="sm"
              className="text-white"
              style={{ padding: '7px 14px', fontSize: 12, backgroundColor: 'hsl(var(--primary))' }}
              onClick={(e) => { e.stopPropagation(); onClick(); }}
            >
              {task.buttonLabel}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              style={{ padding: '7px 14px', fontSize: 12 }}
              onClick={(e) => { e.stopPropagation(); onClick(); }}
            >
              {task.buttonLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── API → TaskCard mapper ────────────────────────────────────────────────────
function mapApiTask(t: any, idx: number): TaskCard {
  const alertLevel = t.currentAlertLevel ?? (t.status === 'overdue' ? 'critical' : null);
  const group: UrgencyGroup =
    alertLevel === 'critical' || t.status === 'overdue' ? 'blocker'
    : alertLevel === 'warning' ? 'warning' : 'inprogress';
  const badge: BadgeKind = group === 'blocker' ? 'BLOCKER' : group === 'warning' ? '75% SLA' : 'ON TRACK';
  const at = (t.activity?.activityType ?? '').toUpperCase();
  const docType: DocType =
    at.includes('BL') || at.includes('LADING') ? 'BL'
    : at.includes('SI') || at.includes('SALES') ? 'SI'
    : at.includes('PL') || at.includes('PACKING') ? 'PL'
    : at.includes('SB') || at.includes('SHIPPING') ? 'SB'
    : at.includes('FF') || at.includes('FREIGHT') ? 'FF'
    : at.includes('MC') ? 'MC' : 'DR';
  const slaTime = t.slaDeadline ? (() => {
    const diff = new Date(t.slaDeadline).getTime() - Date.now();
    if (diff < 0) return `${Math.round(-diff / 3600000)}h overdue`;
    if (diff < 3600000) return `${Math.round(diff / 60000)}m left`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h left`;
    return `${Math.round(diff / 86400000)}d left`;
  })() : '—';
  const slaVariant: SlaVariant = group === 'blocker' ? 'critical' : group === 'warning' ? 'warning' : 'ok';
  return {
    id: idx + 1,
    group,
    docType,
    title: t.activity?.description || t.notes || `Pending · ${t.shipment?.shipmentNumber ?? ''}`,
    badge,
    meta: [
      { label: 'Shipment', value: t.shipment?.shipmentNumber ?? '—' },
      ...(t.stage?.name ? [{ label: 'Stage', value: t.stage.name }] : []),
    ],
    slaPercent: t.slaPercentElapsed ?? 0,
    slaTime,
    slaVariant,
    buttonLabel: 'Review',
    buttonStyle: group === 'blocker' ? 'primary' : 'outline',
    shipmentId: t.shipment?.shipmentNumber ?? '',
  };
}

export function TasksPage() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState(0);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');
  const [tasks, setTasks] = useState<TaskCard[]>(MOCK_TASKS);

  useEffect(() => {
    const token = getAuthToken();
    fetch('/api/tasks/my', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(json => {
        const live: TaskCard[] = (json.data ?? []).map(mapApiTask);
        setTasks(live.length > 0 ? live : MOCK_TASKS);
      })
      .catch(() => { /* keep MOCK_TASKS */ });
  }, []);

  const TABS = [
    { label: 'Pending review', count: 9,   countVariant: 'danger' as const },
    { label: 'In review',      count: 3,   countVariant: 'muted'  as const },
    { label: 'Completed',      count: 142, countVariant: 'muted'  as const },
  ];

  const FILTERS: { key: TaskFilter; label: string }[] = [
    { key: 'all',         label: 'All tasks'   },
    { key: 'by-shipment', label: 'By shipment' },
  ];

  function handleTaskClick(task: TaskCard) {
    const target = task.isReport
      ? '/reports/dsr'
      : `/documents/${task.shipmentId}`;
    navigate(target);
  }

  // Group tasks by shipment
  const shipmentGroups: { shipmentId: string; tasks: TaskCard[] }[] = [];
  if (taskFilter === 'by-shipment') {
    const seen = new Map<string, TaskCard[]>();
    for (const t of tasks) {
      const key = t.shipmentId || 'no-shipment';
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(t);
    }
    for (const [shipmentId, tasks] of seen) {
      shipmentGroups.push({ shipmentId: shipmentId === 'no-shipment' ? '' : shipmentId, tasks });
    }
  }

  return (
    <div className="p-7">

      {/* Section 1: Page Header */}
      <PageHeader
        title="My tasks"
        badge={{ label: 'India logistics · Priya K', variant: 'teal' }}
        subtitle="9 pending tasks across 5 shipments · 2 SLA breached · updated just now"
        actions={
          <Button
            size="sm"
            className="text-white"
            style={{ backgroundColor: 'hsl(var(--primary))' }}
            onClick={() => navigate('/shipments/new')}
          >
            + Create shipment
          </Button>
        }
      />

      {/* Section 2: Escalation banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          padding: '14px 18px',
          borderRadius: 12,
          marginBottom: 20,
          backgroundColor: 'hsla(0,84%,60%,0.08)',
          border: '1px solid hsla(0,84%,60%,0.3)',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: 'hsl(var(--vs-danger))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: '#fff',
            fontSize: 18,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          !
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'hsl(0 84% 40%)' }}>
            2 tasks are past SLA and escalated to your supervisor.
          </div>
          <div style={{ fontSize: 12, color: 'hsl(0 84% 45%)', marginTop: 3, lineHeight: 1.5 }}>
            The packing list for J44CES25090021 was due 18 hours ago. Container validation
            failed — MCS weight mismatch needs resolution before workflow can proceed.
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          style={{ flexShrink: 0, alignSelf: 'center', fontSize: 12 }}
        >
          View details
        </Button>
      </div>

      {/* Section 3: Tab bar + filter sub-tabs */}
      <div style={{ borderBottom: '1px solid hsl(var(--border))', marginBottom: 0 }}>
        {/* Main tabs */}
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          {TABS.map((tab, i) => {
            const isActive = activeTab === i;
            return (
              <button
                key={tab.label}
                onClick={() => setActiveTab(i)}
                style={{
                  padding: '12px 16px',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? '2px solid hsl(var(--primary))' : '2px solid transparent',
                  marginBottom: -1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  transition: 'color 0.12s',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
                <span
                  className="vs-mono"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 999,
                    backgroundColor:
                      tab.countVariant === 'danger'
                        ? 'hsla(0,84%,60%,0.12)'
                        : 'hsl(var(--border))',
                    color:
                      tab.countVariant === 'danger'
                        ? 'hsl(0 84% 45%)'
                        : 'hsl(var(--muted-foreground))',
                  }}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}

          {/* All roles — pushed right */}
          <button
            style={{
              marginLeft: 'auto',
              padding: '12px 16px',
              fontSize: 13,
              fontWeight: 500,
              color: 'hsl(var(--muted-foreground))',
              background: 'none',
              border: 'none',
              borderBottom: '2px solid transparent',
              marginBottom: -1,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            All roles
          </button>
        </div>
      </div>

      {/* Filter sub-tabs: All tasks | By shipment */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '10px 0',
          marginBottom: 16,
          borderBottom: '1px solid hsl(var(--border))',
        }}
      >
        {FILTERS.map((f) => {
          const isActive = taskFilter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setTaskFilter(f.key)}
              style={{
                padding: '5px 14px',
                fontSize: 12,
                fontWeight: isActive ? 600 : 500,
                borderRadius: 6,
                border: isActive
                  ? '1px solid hsl(var(--primary) / 0.4)'
                  : '1px solid transparent',
                backgroundColor: isActive
                  ? 'hsl(var(--primary) / 0.08)'
                  : 'transparent',
                color: isActive
                  ? 'hsl(var(--primary))'
                  : 'hsl(var(--muted-foreground))',
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Section 4: Task list */}
      {taskFilter === 'all' ? (
        /* All tasks — grouped by urgency */
        GROUPS.map((group, gi) => {
          const cards = tasks.filter((t) => t.group === group);
          if (cards.length === 0) return null;
          return (
            <div key={group}>
              <GroupHeader group={group} isFirst={gi === 0} />
              {cards.map((task) => (
                <TaskCardItem
                  key={task.id}
                  task={task}
                  onClick={() => handleTaskClick(task)}
                />
              ))}
            </div>
          );
        })
      ) : (
        /* By shipment — grouped by shipment ID */
        shipmentGroups.map(({ shipmentId, tasks }, gi) => (
          <div key={shipmentId || 'none'}>
            <ShipmentGroupHeader
              shipmentId={shipmentId}
              count={tasks.length}
              isFirst={gi === 0}
            />
            {tasks.map((task) => (
              <TaskCardItem
                key={task.id}
                task={task}
                onClick={() => handleTaskClick(task)}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
