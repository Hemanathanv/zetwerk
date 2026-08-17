import { useLocation } from 'wouter';
import type { ShipmentRow, ProjectDetailData } from '@/hooks/useProjectDetail';

const ICONS = {
  chevronRight: 'ti-chevron-right',
  ship:         'ti-ship',
} as const;

// Gate status → dot colour — built from actual enum values
const GATE_STATUS_COLOUR: Record<string, string> = {
  PASSED:  'bg-teal-500 ring-0',
  ACTIVE:  'bg-teal-500/20 ring-1 ring-teal-500 text-teal-700 dark:text-teal-400',
  OPEN:    'bg-teal-500/20 ring-1 ring-teal-500 text-teal-700 dark:text-teal-400',
  BLOCKED: 'bg-red-500 ring-0',
  SKIPPED: 'bg-muted/60 ring-0 opacity-60',
  FUTURE:  'bg-muted/30 ring-0',
};

// Schedule status → display label + colour class
const SCHEDULE_STATUS_DISPLAY: Record<string, { label: string; cls: string }> = {
  DELAYED: { label: 'Delayed',  cls: 'text-red-600 dark:text-red-400' },
  ON_TIME: { label: 'On time',  cls: 'text-teal-600 dark:text-teal-400' },
  EARLY:   { label: 'Early',    cls: 'text-teal-600 dark:text-teal-400' },
  AHEAD:   { label: 'Ahead',    cls: 'text-teal-600 dark:text-teal-400' },
  AT_RISK: { label: 'At risk',  cls: 'text-amber-600 dark:text-amber-500' },
};

function getDocStatus(approved: number, total: number, pending: number) {
  if (total === 0)   return 'zero';
  if (pending > 0)   return 'warn';
  if (approved === total) return 'ok';
  return 'ok';
}

const DOC_STATUS_CHIP: Record<string, string> = {
  zero: 'bg-muted/40 text-muted-foreground',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
  ok:   'bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400',
};

const SHIPMENT_STATUS_COLOUR: Record<string, string> = {
  active:    'text-teal-600', ACTIVE:    'text-teal-600',
  completed: 'text-green-600', COMPLETED: 'text-green-600',
  pending:   'text-amber-600', PENDING:   'text-amber-600',
  on_hold:   'text-blue-600',  ON_HOLD:   'text-blue-600',
  cancelled: 'text-muted-foreground', CANCELLED: 'text-muted-foreground',
};

const TABLE_COLUMNS = 'grid-cols-[320px_140px_78px_120px_150px_minmax(80px,1fr)_24px]';

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function GateDots({ gates }: { gates: ShipmentRow['gateProgress'] }) {
  if (gates.length === 0) return <span className="text-[12px] text-muted-foreground">—</span>;
  const orderedGates = [...gates].sort((a, b) => a.gateNumber - b.gateNumber);
  return (
    <div className="flex items-center gap-0.5">
      {orderedGates.map((g, i) => (
        <div key={g.gateNumber} className="flex items-center">
          {i > 0 && (
            <div className={`w-3 h-px mx-0.5 ${g.status === 'PASSED' && orderedGates[i - 1]?.status === 'PASSED' ? 'bg-teal-400' : 'bg-muted/50'}`} />
          )}
          <div
            className={`w-3.5 h-3.5 rounded-full text-[7px] flex items-center justify-center font-bold ${GATE_STATUS_COLOUR[g.status] ?? 'bg-muted/30'}`}
            title={`${g.gateName} — ${g.status}`}
          />
        </div>
      ))}
    </div>
  );
}

interface Props {
  shipments: ShipmentRow[];
  project: ProjectDetailData['project'];
}

export function ProjectShipmentTable({ shipments, project }: Props) {
  const [, navigate] = useLocation();

  const handleRowClick = (shipment: ShipmentRow, index: number) => {
    navigate(`/shipments/${shipment.id}`, {
      state: {
        fromProject: {
          projectId:     project.id,
          projectRef:    project.projectCode,
          projectName:   project.projectName,
          projectStatus: project.status,
          shipmentIds:   shipments.map(s => s.id),
          shipmentIndex: index,
        },
      },
    } as any);
  };

  if (shipments.length === 0) {
    return (
      <div className="bg-card rounded-lg p-8 text-center">
        <i className={`ti ${ICONS.ship} text-[28px] text-muted-foreground/40 block mb-2`} />
        <p className="text-[14.5px] text-muted-foreground">No shipments added to this project yet</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg overflow-x-auto border border-border/50">
      {/* Header */}
      <div className={`grid ${TABLE_COLUMNS} min-w-[940px] gap-3 items-center px-5 py-2 border-b border-border/50 bg-muted/20`}>
        {['Shipment', 'Gates', 'Docs', 'Inventory', 'ETA / Status', 'D&D', ''].map((h, i) => (
          <div key={i} className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            {h}
          </div>
        ))}
      </div>

      {/* Rows */}
      {shipments.map((shipment, idx) => {
        const docStatus = getDocStatus(shipment.docApproved, shipment.docTotal, shipment.docPendingReview);
        const schedDisp = shipment.scheduleStatus
          ? (SCHEDULE_STATUS_DISPLAY[shipment.scheduleStatus] ?? { label: shipment.scheduleStatus, cls: 'text-muted-foreground' })
          : null;
        const etaDisplay = shipment.etaLabel ?? (shipment.etaAt ? fmtDate(shipment.etaAt) : null);

        return (
          <button
            key={shipment.id}
            onClick={() => handleRowClick(shipment, idx)}
            className={`w-full grid ${TABLE_COLUMNS} min-w-[940px] gap-3 items-center px-5 py-3 border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors text-left`}
          >
            {/* Shipment */}
            <div className="min-w-0">
              <div className="text-[13px] font-mono font-semibold text-foreground truncate">
                {shipment.shipmentNumber || <span className="font-sans font-normal italic text-muted-foreground">Pending</span>}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
                <span className={`shrink-0 text-[11px] font-semibold uppercase ${SHIPMENT_STATUS_COLOUR[shipment.status] ?? 'text-muted-foreground'}`}>
                  {shipment.status?.replace(/_/g, ' ')}
                </span>
                {shipment.vesselName && (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    {shipment.vesselName}
                  </span>
                )}
              </div>
            </div>

            {/* Gates */}
            <div className="flex items-center">
              <GateDots gates={shipment.gateProgress} />
            </div>

            {/* Docs */}
            <div className="flex items-center">
              <span className={`text-[12px] font-medium px-1.5 py-0.5 rounded ${DOC_STATUS_CHIP[docStatus]}`}>
                {shipment.docTotal > 0 ? `${shipment.docApproved}/${shipment.docTotal}` : '—'}
              </span>
            </div>

            {/* Inventory */}
            <div className="text-[12px] text-muted-foreground">
              {shipment.inventoryLocationLabel ?? '—'}
            </div>

            {/* ETA / Status */}
            <div>
              {etaDisplay ? (
                <>
                  <div className="text-[13px] font-medium text-foreground">{etaDisplay}</div>
                  {schedDisp && (
                    <div className={`text-[11px] font-medium ${schedDisp.cls}`}>{schedDisp.label}</div>
                  )}
                </>
              ) : (
                <span className="text-[12px] text-muted-foreground">—</span>
              )}
            </div>

            {/* D&D */}
            <div className="text-right pr-1">
              {shipment.dndAccruedUsd === null
                ? <span className="text-[12px] text-muted-foreground">—</span>
                : shipment.dndAccruedUsd === 0
                  ? <span className="text-[12px] text-muted-foreground">$0</span>
                  : <span className="text-[12px] font-medium text-red-600 dark:text-red-400 font-mono">
                      {formatCurrency(shipment.dndAccruedUsd)}
                    </span>
              }
            </div>

            {/* Arrow */}
            <div className="flex justify-end">
              <i className={`ti ${ICONS.chevronRight} text-[14px] text-muted-foreground/40`} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
