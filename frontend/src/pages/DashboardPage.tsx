import { useLocation } from 'wouter';
import { useEffect, useState } from 'react';
import { FolderKanban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MetricCard, StatusPill, PageHeader } from '@/components/vs';
import { MOCK_SHIPMENTS, ALERT_PILL, MOCK_DOC_SLA, DocSlaStatus, PROJECTS } from '@/data/mockShipments';
import { getAuthToken } from '@/lib/api';

const ACTIVE_PROJECT_COUNT = PROJECTS.filter(
  (p) => p.projectStatus === 'Active' || p.projectStatus === 'In Transit'
).length;

const PROJECT_STATUS_STYLES: Record<string, { bg: string; color: string; dot: string }> = {
  Active:      { bg: 'hsla(173,58%,39%,0.12)', color: 'hsl(173 58% 32%)',  dot: 'hsl(173 58% 39%)' },
  'In Transit':{ bg: 'hsla(217,91%,60%,0.10)', color: 'hsl(217 91% 40%)', dot: 'hsl(217 91% 55%)' },
  Blocked:     { bg: 'hsla(0,84%,60%,0.10)',   color: 'hsl(0 84% 40%)',   dot: 'hsl(0 84% 55%)'   },
  Completed:   { bg: 'hsla(142,71%,45%,0.10)', color: 'hsl(142 71% 30%)', dot: 'hsl(142 71% 40%)' },
};

const PHASE_META = [
  { phase: 1, label: 'Booked',         color: 'hsl(220 14% 70%)' },
  { phase: 2, label: 'Departed India',  color: 'hsl(var(--vs-info))' },
  { phase: 3, label: 'Ocean transit',   color: 'hsl(var(--primary))' },
  { phase: 4, label: 'US port',         color: 'hsl(var(--vs-warning))' },
  { phase: 5, label: 'Customs',         color: 'hsl(38 92% 38%)' },
  { phase: 6, label: 'Delivered (MTD)', color: 'hsl(var(--vs-success))' },
];

const phaseTally = MOCK_SHIPMENTS.reduce<Record<number, number>>((acc, s) => {
  acc[s.journeyPhase] = (acc[s.journeyPhase] ?? 0) + 1;
  return acc;
}, {});

const PHASE_COUNTS = PHASE_META.map((m) => ({
  ...m,
  count: phaseTally[m.phase] ?? 0,
}));

const MAX_COUNT = Math.max(...PHASE_COUNTS.map((p) => p.count), 1);

const ACTIVE_ALERTS = MOCK_SHIPMENTS.filter((s) => s.alert !== null || s.docDanger);

const DOC_SLA_SORTED = [...MOCK_DOC_SLA].sort((a, b) => {
  const order: Record<DocSlaStatus, number> = { breached: 0, 'on-track': 1, pending: 2 };
  return order[a.status] - order[b.status];
});

const DOC_SLA_COUNTS = {
  breached: MOCK_DOC_SLA.filter((d) => d.status === 'breached').length,
  onTrack:  MOCK_DOC_SLA.filter((d) => d.status === 'on-track').length,
  pending:  MOCK_DOC_SLA.filter((d) => d.status === 'pending').length,
};

const DOC_STATUS_STYLES: Record<DocSlaStatus, { bg: string; color: string; label: string }> = {
  breached:  { bg: 'hsla(0,84%,60%,0.10)',   color: 'hsl(0 84% 45%)',    label: 'Breached' },
  'on-track': { bg: 'hsla(152,69%,31%,0.10)', color: 'hsl(152 69% 25%)', label: 'On track' },
  pending:   { bg: 'hsl(var(--muted))',        color: 'hsl(var(--muted-foreground))', label: 'Pending' },
};

const RECENT = [...MOCK_SHIPMENTS]
  .sort((a, b) => a.updatedMinsAgo - b.updatedMinsAgo)
  .slice(0, 5);

function formatAgo(mins: number): string {
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ago`;
}

interface ExtractionStats {
  total: number;
  extracted: number;
  processing: number;
  failed: number;
}

export function DashboardPage() {
  const [, navigate] = useLocation();
  const [extractionStats, setExtractionStats] = useState<ExtractionStats | null>(null);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    fetch('/api/stats/extraction?since=7d', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setExtractionStats(json.data as ExtractionStats);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="p-7">
      <PageHeader
        title="Operations overview"
        subtitle="India → US export corridor · cross-module summary · updated 2 minutes ago"
        actions={
          <>
            <Button variant="outline" size="sm">Export report</Button>
            <Button
              size="sm"
              className="text-white"
              style={{ backgroundColor: 'hsl(var(--primary))' }}
              onClick={() => navigate('/shipments')}
            >
              View all shipments
            </Button>
          </>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-7">
        <MetricCard label="Active shipments" value={47} subText="+3 this week"            subTextColor="success" accentColor="teal"    />
        <MetricCard label="In transit"        value={28} subText="14 on vessel · 14 at US" subTextColor="muted"   accentColor="info"    />
        {extractionStats !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <MetricCard
              label="Extraction rate"
              value={`${extractionStats.extracted} / ${extractionStats.total}`}
              subText={
                extractionStats.total > 0
                  ? `${Math.round((extractionStats.extracted / extractionStats.total) * 100)}% extracted this week`
                  : 'No docs this week'
              }
              subTextColor={extractionStats.failed > 0 ? 'warning' : 'success'}
              accentColor="info"
            />
            {extractionStats.total > 0 && (
              <div style={{ padding: '0 16px 12px', marginTop: -8 }}>
                <div style={{ height: 3, borderRadius: 99, background: 'hsl(var(--border))' }}>
                  <div
                    style={{
                      height: '100%',
                      borderRadius: 99,
                      background: 'hsl(var(--vs-info))',
                      width: `${Math.round((extractionStats.extracted / extractionStats.total) * 100)}%`,
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <MetricCard label="Extraction rate" value="—" subText="Loading…" subTextColor="muted" accentColor="info" />
        )}
        <MetricCard label="D&D risk"          value={2}  subText="LFD in 48 hrs"           subTextColor="danger"  accentColor="danger"  />
        <MetricCard label="Delivered (MTD)"   value={19} subText="+5 vs last month"        subTextColor="success" accentColor="success" />
        <div
          onClick={() => navigate('/projects')}
          style={{ cursor: 'pointer' }}
          onMouseEnter={(e) => {
            const card = (e.currentTarget as HTMLDivElement).firstElementChild as HTMLDivElement | null;
            if (card) { card.style.transform = 'translateY(-2px)'; card.style.boxShadow = 'var(--vs-shadow-elevated)'; }
          }}
          onMouseLeave={(e) => {
            const card = (e.currentTarget as HTMLDivElement).firstElementChild as HTMLDivElement | null;
            if (card) { card.style.transform = ''; card.style.boxShadow = 'var(--vs-shadow-card)'; }
          }}
        >
          <MetricCard
            label="Active Projects"
            value={ACTIVE_PROJECT_COUNT}
            subText={`${PROJECTS.length} total projects`}
            subTextColor="success"
            accentColor="teal"
          />
        </div>
      </div>

      {/* Phase Funnel */}
      <div
        className="rounded-xl bg-card mb-5"
        style={{ boxShadow: 'var(--vs-shadow-card)', padding: '22px 28px' }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
            Shipment pipeline
          </span>
          <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
            47 shipments across 6 phases — click a phase to filter
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          {PHASE_COUNTS.map(({ phase, label, count, color }) => {
            const barH = Math.max(28, Math.round((count / MAX_COUNT) * 90));
            return (
              <button
                key={phase}
                onClick={() => navigate(`/shipments?phase=${phase}`)}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 4px',
                  borderRadius: 10,
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'hsl(var(--background))'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                <span
                  className="vs-mono font-semibold"
                  style={{ fontSize: 18, color: 'hsl(var(--foreground))', lineHeight: 1 }}
                >
                  {count}
                </span>

                <div
                  style={{
                    width: '100%',
                    height: barH,
                    borderRadius: 6,
                    backgroundColor: color,
                    opacity: 0.85,
                    transition: 'opacity 0.12s',
                  }}
                />

                <div style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: color,
                      display: 'inline-block',
                      marginBottom: 3,
                    }}
                  />
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: 'hsl(var(--muted-foreground))',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      lineHeight: 1.3,
                    }}
                  >
                    {label}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Document SLA panel */}
      <div
        className="rounded-xl bg-card mb-5"
        style={{ boxShadow: 'var(--vs-shadow-card)', padding: '22px 28px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              Document SLA
            </span>
            <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
              {MOCK_DOC_SLA.length} outstanding documents across active shipments
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 999, background: 'hsla(0,84%,60%,0.10)', color: 'hsl(0 84% 45%)' }}>
              {DOC_SLA_COUNTS.breached} breached
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 999, background: 'hsla(152,69%,31%,0.10)', color: 'hsl(152 69% 25%)' }}>
              {DOC_SLA_COUNTS.onTrack} on track
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 999, background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
              {DOC_SLA_COUNTS.pending} pending
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 8 }}>
          {DOC_SLA_SORTED.map((doc, idx) => {
            const style = DOC_STATUS_STYLES[doc.status];
            const isBreached = doc.status === 'breached';
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: isBreached ? 'hsla(0,84%,60%,0.04)' : 'hsl(var(--background))',
                  border: `1px solid ${isBreached ? 'hsla(0,84%,60%,0.15)' : 'hsl(var(--border))'}`,
                }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    width: 44,
                    height: 28,
                    borderRadius: 5,
                    background: style.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: style.color,
                    fontFamily: 'JetBrains Mono, monospace',
                    letterSpacing: '0.04em',
                  }}
                >
                  {doc.docType}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="vs-mono" style={{ fontSize: 11, fontWeight: 600, color: 'hsl(var(--foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {doc.shipmentId}
                  </div>
                  <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {doc.note}
                  </div>
                </div>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: style.bg,
                    color: style.color,
                    whiteSpace: 'nowrap',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {doc.dueLabel}
                </span>
                {isBreached && (
                  <button
                    onClick={() => navigate(`/shipments/${doc.shipmentId}`)}
                    style={{
                      flexShrink: 0,
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'hsl(var(--primary))',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '2px 6px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Open →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom row: Active Alerts + Recently Updated */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Active Alerts */}
        <div
          className="rounded-xl bg-card"
          style={{ boxShadow: 'var(--vs-shadow-card)', padding: '20px 24px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              Needs attention
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'hsla(0,84%,60%,0.1)',
                color: 'hsl(0 84% 45%)',
              }}
            >
              {ACTIVE_ALERTS.length} active
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ACTIVE_ALERTS.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: s.alert!.variant === 'danger'
                    ? 'hsla(0,84%,60%,0.05)'
                    : 'hsla(38,92%,50%,0.06)',
                  border: `1px solid ${s.alert!.variant === 'danger' ? 'hsla(0,84%,60%,0.15)' : 'hsla(38,92%,50%,0.18)'}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="vs-mono" style={{ fontSize: 12, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
                    {s.id}
                  </div>
                  <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
                    {s.docDanger ? s.docNote : `${s.stage} · ${s.etaPort !== '—' ? s.etaPort : 'Pre-shipment'}`}
                  </div>
                </div>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '2px 8px',
                    borderRadius: 999,
                    backgroundColor: ALERT_PILL[s.alert!.variant].bg,
                    color: ALERT_PILL[s.alert!.variant].color,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.alert!.text}
                </span>
                <button
                  onClick={() => navigate(`/shipments/${s.id}`)}
                  style={{
                    flexShrink: 0,
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'hsl(var(--primary))',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px 6px',
                    borderRadius: 4,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Open →
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Recently Updated */}
        <div
          className="rounded-xl bg-card"
          style={{ boxShadow: 'var(--vs-shadow-card)', padding: '20px 24px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              Recently updated
            </span>
            <button
              onClick={() => navigate('/shipments')}
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: 'hsl(var(--primary))',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              View all →
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {RECENT.map((s, idx) => (
              <div
                key={s.id}
                onClick={() => navigate(`/shipments/${s.id}`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: idx < RECENT.length - 1 ? '1px solid hsl(220 14% 95%)' : 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '0.75'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="vs-mono font-semibold"
                    style={{ fontSize: 12, color: 'hsl(var(--primary))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {s.id}
                  </div>
                  <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
                    {s.route}
                  </div>
                </div>
                <StatusPill status={s.stage} variant={s.stageVariant} />
                <span
                  style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', flexShrink: 0, fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {formatAgo(s.updatedMinsAgo)}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Projects Overview panel — full width */}
      <div
        className="rounded-xl bg-card mt-5"
        style={{ boxShadow: 'var(--vs-shadow-card)', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 24px', borderBottom: '1px solid hsl(var(--border))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderKanban size={14} style={{ color: 'hsl(173 58% 39%)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              Projects Overview
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
              background: 'hsla(173,58%,39%,0.12)', color: 'hsl(173 58% 32%)',
            }}>
              {PROJECTS.length} projects
            </span>
          </div>
          <button
            onClick={() => navigate('/projects')}
            style={{
              fontSize: 11, fontWeight: 500, color: 'hsl(173 58% 39%)',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            View all →
          </button>
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid hsl(var(--border))' }}>
              {['Project', 'Client Ref', 'Commodity', 'Shipments', 'Status'].map((h) => (
                <th key={h} style={{
                  padding: '8px 20px', textAlign: 'left', fontSize: 10,
                  fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
                  color: 'hsl(var(--muted-foreground))',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PROJECTS.map((project, idx) => {
              const projectShipments = MOCK_SHIPMENTS.filter((s) =>
                project.shipmentIds.includes(s.id)
              );
              const alertCount = projectShipments.filter((s) => s.alert !== null).length;
              const ps = PROJECT_STATUS_STYLES[project.projectStatus] ?? PROJECT_STATUS_STYLES['In Transit'];
              return (
                <tr
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  style={{
                    borderBottom: idx < PROJECTS.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'hsl(var(--background))')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'transparent')}
                >
                  <td style={{ padding: '12px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                        background: 'hsla(173,58%,39%,0.10)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <FolderKanban size={13} style={{ color: 'hsl(173 58% 39%)' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
                          {project.projectName}
                        </div>
                        <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 1, fontFamily: 'monospace' }}>
                          {project.id}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 20px' }}>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'hsl(var(--foreground))' }}>
                      {project.clientRef}
                    </span>
                  </td>
                  <td style={{ padding: '12px 20px' }}>
                    <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
                      {project.commodity}
                    </span>
                  </td>
                  <td style={{ padding: '12px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'hsl(var(--foreground))' }}>
                        {projectShipments.length}
                      </span>
                      {alertCount > 0 && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999,
                          background: 'hsla(0,84%,60%,0.10)', color: 'hsl(0 84% 45%)',
                        }}>
                          {alertCount} alert{alertCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '12px 20px' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                      background: ps.bg, color: ps.color,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: ps.dot, flexShrink: 0 }} />
                      {project.projectStatus}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
