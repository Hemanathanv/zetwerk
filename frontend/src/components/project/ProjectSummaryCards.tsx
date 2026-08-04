import type { ProjectDetailData } from '@/hooks/useProjectDetail';
import { MetricCard } from '@/components/vs/MetricCard';

function formatCurrency(value: number, currency: string = 'USD'): string {
  return value.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });
}

interface Props {
  summary: ProjectDetailData['summary'];
}

export function ProjectSummaryCards({ summary }: Props) {
  const {
    totalShipments,
    totalDocuments,
    approvedDocuments,
    totalInventoryQt,
    totalInventoryUom,
    totalDndAccruedUsd,
  } = summary;

  const formatInventory = () => {
    if (totalInventoryQt === null) return '-';
    if (totalInventoryUom === 'kg') {
      if (totalInventoryQt >= 1000) {
        return `${(totalInventoryQt / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} t`;
      }
      return `${totalInventoryQt.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg`;
    }
    return `${totalInventoryQt.toLocaleString()} ${totalInventoryUom ?? ''}`.trim();
  };

  return (
    <div className="grid grid-cols-2 gap-4 mb-6 lg:grid-cols-4">
      <MetricCard label="Shipments" value={totalShipments} />
      <MetricCard label="Documents" value={totalDocuments > 0 ? `${approvedDocuments}/${totalDocuments}` : '-'} />
      <MetricCard label="Inventory" value={formatInventory()} />
      <MetricCard label="D&D Exposure" value={formatCurrency(totalDndAccruedUsd)} />
    </div>
  );
}
