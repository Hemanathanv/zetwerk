import { useState } from 'react';
import { useLocation } from 'wouter';
import { Package, FileCheck, AlertCircle, AlertTriangle, FolderKanban } from 'lucide-react';
import { shipments } from '@/data/mockData';
import { PROJECTS, MOCK_SHIPMENTS } from '@/data/mockShipments';
import { KpiCard } from '@/components/KpiCard';
import { ShipmentTable } from '@/components/ShipmentTable';
import { ShipmentDetailPanel } from '@/components/ShipmentDetailPanel';
import { ProcessFlowCard } from '@/components/ProcessFlowCard';

const activeProjectsCount = PROJECTS.filter(
  (p) => p.projectStatus === 'Active' || p.projectStatus === 'In Transit'
).length;

type KpiItem = {
  label: string;
  value: string | number;
  delta: string;
  deltaPositive: boolean;
  sparklineData: number[];
  icon: React.ReactNode;
  accentColor: string;
  href?: string;
};

const kpiData: KpiItem[] = [
  {
    label: 'Active Shipments',
    value: 0,
    delta: 'No data',
    deltaPositive: true,
    sparklineData: [0, 0, 0, 0, 0, 0, 0],
    icon: <Package className="w-4 h-4" />,
    accentColor: 'hsl(199 89% 48%)',
  },
  {
    label: 'Waiting List',
    value: 0,
    delta: 'No data',
    deltaPositive: false,
    sparklineData: [0, 0, 0, 0, 0, 0, 0],
    icon: <FileCheck className="w-4 h-4" />,
    accentColor: 'hsl(152 69% 35%)',
  },
  {
    label: 'Pending AE',
    value: 0,
    delta: 'No data',
    deltaPositive: false,
    sparklineData: [0, 0, 0, 0, 0, 0, 0],
    icon: <AlertCircle className="w-4 h-4" />,
    accentColor: 'hsl(45 93% 47%)',
  },
  {
    label: 'D&D Risk',
    value: 0,
    delta: 'No data',
    deltaPositive: false,
    sparklineData: [0, 0, 0, 0, 0, 0, 0],
    icon: <AlertTriangle className="w-4 h-4" />,
    accentColor: 'hsl(0 84% 60%)',
  },
  {
    label: 'Active Projects',
    value: activeProjectsCount,
    delta: 'No data',
    deltaPositive: true,
    sparklineData: [0, 0, 0, 0, 0, 0, 0],
    icon: <FolderKanban className="w-4 h-4" />,
    accentColor: 'hsl(173 58% 39%)',
    href: '/projects',
  },
];

const STATUS_STYLES: Record<string, { bg: string; color: string; dot: string }> = {
  Active:      { bg: 'hsla(173,58%,39%,0.12)', color: 'hsl(173 58% 32%)',  dot: 'hsl(173 58% 39%)' },
  'In Transit':{ bg: 'hsla(217,91%,60%,0.10)', color: 'hsl(217 91% 40%)', dot: 'hsl(217 91% 55%)' },
  Blocked:     { bg: 'hsla(0,84%,60%,0.10)',   color: 'hsl(0 84% 40%)',   dot: 'hsl(0 84% 55%)'   },
  Completed:   { bg: 'hsla(142,71%,45%,0.10)', color: 'hsl(142 71% 30%)', dot: 'hsl(142 71% 40%)' },
};

export function Dashboard() {
  const [selectedId, setSelectedId] = useState('');
  const [, navigate] = useLocation();
  const selectedShipment = shipments.find((s) => s.id === selectedId);

  return (
    <div className="flex flex-col gap-5 p-6 min-h-full">
      {/* Page title */}
      <div>
        <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: 0, color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>Shipment Operations</h1>
        <p style={{ fontSize: 'var(--text-subtitle-size)', color: 'hsl(var(--muted-foreground))', marginTop: 4, marginBottom: 0 }}>
          Active shipments · Real-time tracking · Document workflows
        </p>
      </div>

      {/* KPI Cards — 5 columns */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        {kpiData.map((kpi) => (
          <div
            key={kpi.label}
            onClick={() => kpi.href && navigate(kpi.href)}
            style={{
              cursor: kpi.href ? 'pointer' : 'default',
              borderRadius: 8,
              transition: kpi.href ? 'box-shadow 0.15s' : undefined,
            }}
            onMouseEnter={(e) => {
              if (kpi.href) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 2px hsl(173 58% 39% / 0.35)';
            }}
            onMouseLeave={(e) => {
              if (kpi.href) (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
            }}
          >
            <KpiCard
              label={kpi.label}
              value={kpi.value}
              delta={kpi.delta}
              deltaPositive={kpi.deltaPositive}
              sparklineData={kpi.sparklineData}
              icon={kpi.icon}
              accentColor={kpi.accentColor}
            />
          </div>
        ))}
      </div>

      {/* Main split layout */}
      <div className="flex gap-4 min-h-0" style={{ minHeight: 520 }}>
        {/* Left: Shipment Table */}
        <div
          className="flex-[6] min-w-0 bg-card border rounded-lg overflow-hidden flex flex-col"
          style={{ borderColor: 'hsl(var(--card-border))' }}
          data-testid="shipment-table-card"
        >
          <div
            className="flex items-center justify-between px-4 pt-3 pb-2 border-b"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            <h2 className="text-[14.5px] font-semibold">Shipment Grid</h2>
            <span className="text-[12px] text-muted-foreground font-medium uppercase tracking-wide">
              {shipments.length} records
            </span>
          </div>
          <ShipmentTable
            shipments={shipments}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {/* Right: Shipment Detail */}
        <div
          className="flex-[4] min-w-0 bg-card border rounded-lg overflow-hidden flex flex-col"
          style={{ borderColor: 'hsl(var(--card-border))' }}
          data-testid="shipment-detail-card"
        >
          <ShipmentDetailPanel shipment={selectedShipment} />
        </div>
      </div>

      {/* Bottom: Process Flow */}
      <div className="grid grid-cols-1 gap-4">
        <ProcessFlowCard />
      </div>

      {/* Projects Overview panel — full width */}
      <div
        className="bg-card border rounded-lg overflow-hidden"
        style={{ borderColor: 'hsl(var(--card-border))' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 pt-3 pb-2 border-b"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <div className="flex items-center gap-2">
            <FolderKanban size={14} style={{ color: 'hsl(173 58% 39%)' }} />
            <h2 className="text-[14.5px] font-semibold">Projects Overview</h2>
            <span
              style={{
                fontSize: 14, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
                background: 'hsla(173,58%,39%,0.12)', color: 'hsl(173 58% 32%)',
              }}
            >
              {PROJECTS.length} projects
            </span>
          </div>
          <button
            onClick={() => navigate('/projects')}
            style={{
              fontSize: 14.5, fontWeight: 500, color: 'hsl(173 58% 39%)',
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
                  padding: '8px 16px', textAlign: 'left', fontSize: 14,
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
              const s = STATUS_STYLES[project.projectStatus] ?? STATUS_STYLES['In Transit'];

              return (
                <tr
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  style={{
                    borderBottom: idx < PROJECTS.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'hsl(var(--accent))')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = 'transparent')}
                >
                  {/* Project name */}
                  <td style={{ padding: '11px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                        background: 'hsla(173,58%,39%,0.10)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <FolderKanban size={13} style={{ color: 'hsl(173 58% 39%)' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
                          {project.projectName}
                        </div>
                        <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 1, fontFamily: 'var(--app-font-sans)' }}>
                          {project.id}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Client ref */}
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{ fontSize: 14.5, fontFamily: 'var(--app-font-sans)', color: 'hsl(var(--foreground))' }}>
                      {project.clientRef}
                    </span>
                  </td>

                  {/* Commodity */}
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                      {project.commodity}
                    </span>
                  </td>

                  {/* Shipment count */}
                  <td style={{ padding: '11px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: 'hsl(var(--foreground))' }}>
                        {projectShipments.length}
                      </span>
                      {alertCount > 0 && (
                        <span style={{
                          fontSize: 14, fontWeight: 600, padding: '1px 6px', borderRadius: 999,
                          background: 'hsla(0,84%,60%,0.10)', color: 'hsl(0 84% 45%)',
                        }}>
                          {alertCount} alert{alertCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Status */}
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 8px', borderRadius: 999, fontSize: 14.5, fontWeight: 500,
                      background: s.bg, color: s.color,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
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
