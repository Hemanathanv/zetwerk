import type { ProjectDetailData } from '@/hooks/useProjectDetail';

const ICONS = {
  ship:     'ti-ship',
  fileCheck: 'ti-file-check',
  package:  'ti-package',
  clock:    'ti-clock',
} as const;

function formatCurrency(value: number, currency: string = 'USD'): string {
  return value.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });
}

function ProgressBar({ pct, colour }: { pct: number; colour: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden mt-2 mb-1">
      <div className={`h-full rounded-full transition-all ${colour}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

interface CardProps {
  icon: string;
  label: string;
  children: React.ReactNode;
}

function SummaryCard({ icon, label, children }: CardProps) {
  return (
    <div className="bg-card rounded-xl p-5 flex flex-col min-w-0">
      <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground uppercase tracking-wide mb-3">
        <i className={`ti ${icon} text-[14px]`} />
        {label}
      </div>
      {children}
    </div>
  );
}

interface Props {
  summary: ProjectDetailData['summary'];
}

export function ProjectSummaryCards({ summary }: Props) {
  const {
    totalShipments, deliveredShipments,
    totalDocuments, approvedDocuments, pendingReviewDocuments,
    totalInventoryQt, totalInventoryUom,
    deliveredInventoryKg, inTransitInventoryKg,
    totalDndAccruedUsd, activeDndContainerCount, activeDndLfds,
  } = summary;

  const shipmentPct = totalShipments > 0
    ? Math.round((deliveredShipments / totalShipments) * 100)
    : 0;

  const docPct = totalDocuments > 0
    ? Math.round((approvedDocuments / totalDocuments) * 100)
    : 0;

  const invPct = (totalInventoryQt ?? 0) > 0 && (deliveredInventoryKg ?? 0) >= 0
    ? Math.round(((deliveredInventoryKg ?? 0) / (totalInventoryQt ?? 1)) * 100)
    : 0;

  const fmtKg = (kg: number | null) => {
    if (kg === null) return '—';
    if (kg >= 1000) return `${(kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} t`;
    return `${kg.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg`;
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

      {/* Card 1 — Shipments */}
      <SummaryCard icon={ICONS.ship} label="Shipments">
        <div className="text-[28px] font-mono font-bold text-foreground leading-none">
          {totalShipments}
        </div>
        {totalShipments > 0 && (
          <ProgressBar pct={shipmentPct} colour={shipmentPct === 100 ? 'bg-green-500' : 'bg-teal-500'} />
        )}
        <div className="text-[12px] text-muted-foreground">
          {deliveredShipments} of {totalShipments} delivered
        </div>
      </SummaryCard>

      {/* Card 2 — Documents */}
      <SummaryCard icon={ICONS.fileCheck} label="Documents">
        <div className="text-[28px] font-mono font-bold text-foreground leading-none">
          {totalDocuments > 0 ? `${approvedDocuments}/${totalDocuments}` : '—'}
        </div>
        {totalDocuments > 0 && (
          <ProgressBar pct={docPct} colour={docPct === 100 ? 'bg-green-500' : 'bg-teal-500'} />
        )}
        <div className={`text-[12px] ${pendingReviewDocuments > 0 ? 'text-amber-600 dark:text-amber-500 font-medium' : 'text-muted-foreground'}`}>
          {pendingReviewDocuments > 0
            ? `${pendingReviewDocuments} pending review`
            : totalDocuments > 0 ? 'All reviewed' : 'No documents yet'}
        </div>
      </SummaryCard>

      {/* Card 3 — Inventory */}
      <SummaryCard icon={ICONS.package} label="Inventory">
        {totalInventoryQt !== null ? (
          <>
            <div className="text-[28px] font-mono font-bold text-foreground leading-none">
              {totalInventoryUom === 'kg' ? fmtKg(totalInventoryQt) : `${totalInventoryQt.toLocaleString()} ${totalInventoryUom ?? ''}`}
            </div>
            {deliveredInventoryKg !== null && totalInventoryQt > 0 && (
              <ProgressBar pct={invPct} colour={invPct === 100 ? 'bg-green-500' : 'bg-teal-500'} />
            )}
            <div className="text-[12px] text-muted-foreground">
              {deliveredInventoryKg !== null ? fmtKg(deliveredInventoryKg) : '—'} delivered
              {inTransitInventoryKg !== null && inTransitInventoryKg > 0
                ? ` · ${fmtKg(inTransitInventoryKg)} in transit`
                : ''}
            </div>
          </>
        ) : (
          <>
            <div className="text-[24px] font-mono text-muted-foreground leading-none">—</div>
            <div className="text-[12px] text-muted-foreground mt-2">Inventory tracking not active</div>
          </>
        )}
      </SummaryCard>

      {/* Card 4 — D&D */}
      <SummaryCard icon={ICONS.clock} label="D&D Exposure">
        <div className={`text-[28px] font-mono font-bold leading-none ${totalDndAccruedUsd > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
          {formatCurrency(totalDndAccruedUsd)}
        </div>
        <div className="mt-2" />
        {activeDndContainerCount > 0 ? (
          <div className="text-[12px] text-red-600 dark:text-red-400 font-medium">
            {activeDndContainerCount} container{activeDndContainerCount > 1 ? 's' : ''} accruing
            {activeDndLfds.length > 0 && (
              <span className="text-muted-foreground font-normal ml-1">
                · LFD {activeDndLfds[0]}
              </span>
            )}
          </div>
        ) : (
          <div className="text-[12px] text-teal-600 dark:text-teal-400 font-medium">No active D&D</div>
        )}
      </SummaryCard>

    </div>
  );
}
