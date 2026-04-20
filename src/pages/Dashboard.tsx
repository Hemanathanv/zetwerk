import { useState } from 'react';
import { Package, FileCheck, AlertCircle, AlertTriangle } from 'lucide-react';
import { shipments } from '@/data/mockData';
import { KpiCard } from '@/components/KpiCard';
import { ShipmentTable } from '@/components/ShipmentTable';
import { ShipmentDetailPanel } from '@/components/ShipmentDetailPanel';
import { UploadDropzone } from '@/components/UploadDropzone';
import { ProcessFlowCard } from '@/components/ProcessFlowCard';

const kpiData = [
  {
    label: 'Active Shipments',
    value: 124,
    delta: '+8 this week',
    deltaPositive: true,
    sparklineData: [80, 95, 88, 102, 98, 110, 124],
    icon: <Package className="w-4 h-4" />,
    accentColor: 'hsl(199 89% 48%)',
  },
  {
    label: 'Documents Processed',
    value: '15 / 15',
    delta: '100% processed',
    deltaPositive: true,
    sparklineData: [5, 8, 10, 12, 14, 15, 15],
    icon: <FileCheck className="w-4 h-4" />,
    accentColor: 'hsl(152 69% 35%)',
  },
  {
    label: 'Pending Validations',
    value: 4,
    delta: '-2 since yesterday',
    deltaPositive: false,
    sparklineData: [8, 6, 7, 5, 6, 5, 4],
    icon: <AlertCircle className="w-4 h-4" />,
    accentColor: 'hsl(45 93% 47%)',
  },
  {
    label: 'Customs Exceptions',
    value: 2,
    delta: '1 new today',
    deltaPositive: false,
    sparklineData: [1, 2, 1, 3, 2, 2, 2],
    icon: <AlertTriangle className="w-4 h-4" />,
    accentColor: 'hsl(0 84% 60%)',
  },
];

export function Dashboard() {
  const [selectedId, setSelectedId] = useState('SH1002');
  const selectedShipment = shipments.find((s) => s.id === selectedId);

  return (
    <div className="flex flex-col gap-5 p-6 min-h-full">
      {/* Page title */}
      <div>
        <h1 className="text-lg font-bold text-foreground">Shipment Operations</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Active shipments · Real-time tracking · Document workflows
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {kpiData.map((kpi) => (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            delta={kpi.delta}
            deltaPositive={kpi.deltaPositive}
            sparklineData={kpi.sparklineData}
            icon={kpi.icon}
            accentColor={kpi.accentColor}
          />
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
            <h2 className="text-sm font-semibold">Shipment Grid</h2>
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
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

      {/* Bottom: Upload + Process Flow */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UploadDropzone />
        <ProcessFlowCard />
      </div>
    </div>
  );
}
