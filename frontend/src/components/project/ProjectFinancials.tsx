import type { ProjectDetailData } from '@/hooks/useProjectDetail';

const DEFAULT_CURRENCY = 'USD';

const formatCurrency = (value: number, currency: string = DEFAULT_CURRENCY): string =>
  value.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });

function FinCell({
  label, value, sub, valueCls,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueCls?: string;
}) {
  return (
    <div className="bg-muted/10 rounded-lg p-4 border border-border/40">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
        {label}
      </div>
      <div className={`text-[15px] font-mono font-semibold ${valueCls ?? 'text-foreground'}`}>
        {value}
      </div>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  );
}

interface Props {
  financials: ProjectDetailData['financials'];
}

export function ProjectFinancials({ financials }: Props) {
  const {
    contractValueUsd, apInvoicesUsd, apApprovedCount, apOverdueCount,
    freightCostsUsd, dndAccruedUsd, revenueRecognisedUsd, outstandingUsd,
  } = financials;

  const fmtVal = (v: number | null) =>
    v === null ? <span className="text-muted-foreground font-sans font-normal text-[14px]">—</span>
               : formatCurrency(v);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <i className="ti ti-report-money text-[14px]" />
          Financial snapshot
        </h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">

        <FinCell
          label="Contract value"
          value={fmtVal(contractValueUsd)}
        />

        <FinCell
          label="AP invoices"
          value={fmtVal(apInvoicesUsd)}
          sub={
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground">{apApprovedCount} approved</span>
              {apOverdueCount > 0 && (
                <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
                  · {apOverdueCount} overdue
                </span>
              )}
            </div>
          }
        />

        <FinCell
          label="D&D accrued"
          value={dndAccruedUsd > 0 ? formatCurrency(dndAccruedUsd) : '$0'}
          valueCls={dndAccruedUsd > 0 ? 'text-red-600 dark:text-red-400 font-mono font-semibold text-[15px]' : 'text-muted-foreground font-mono font-semibold text-[15px]'}
        />

        <FinCell
          label="Freight costs"
          value={fmtVal(freightCostsUsd)}
        />

        <FinCell
          label="Revenue recognised"
          value={fmtVal(revenueRecognisedUsd)}
        />

        <FinCell
          label="Outstanding"
          value={fmtVal(outstandingUsd)}
        />

      </div>
    </div>
  );
}
