import { Zap, FileText, Ship, Warehouse, Truck, CheckCircle2, GitBranch, ArrowRight, RefreshCw } from 'lucide-react';

type FlowStep = {
  id: string;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  status: 'completed' | 'active' | 'pending';
  isBranch?: boolean;
  branchYes?: string;
  branchNo?: string;
  isEnd?: boolean;
};

const steps: FlowStep[] = [
  {
    id: 'trigger',
    icon: <Zap className="w-3.5 h-3.5" />,
    label: 'Trigger',
    sublabel: 'Sales invoice imported',
    status: 'completed',
  },
  {
    id: 's1',
    icon: <FileText className="w-3.5 h-3.5" />,
    label: 'Stage 1',
    sublabel: 'Invoice creation + India-side docs',
    status: 'completed',
  },
  {
    id: 'branch',
    icon: <GitBranch className="w-3.5 h-3.5" />,
    label: 'Container No. in BOL?',
    status: 'completed',
    isBranch: true,
    branchYes: 'Yes → Continue',
    branchNo: 'No → Request from carrier',
  },
  {
    id: 's2',
    icon: <Ship className="w-3.5 h-3.5" />,
    label: 'Stage 2',
    sublabel: 'Container movement: India → US Port',
    status: 'active',
  },
  {
    id: 's3',
    icon: <Warehouse className="w-3.5 h-3.5" />,
    label: 'Stage 3',
    sublabel: 'Custom WH → 3PL WH',
    status: 'pending',
  },
  {
    id: 's4',
    icon: <Truck className="w-3.5 h-3.5" />,
    label: 'Stage 4',
    sublabel: '3PL WH → Customer',
    status: 'pending',
  },
  {
    id: 'end',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    label: 'Closed',
    sublabel: 'POD validated — Shipment Closed',
    status: 'pending',
    isEnd: true,
  },
];

const statusStyles: Record<string, { card: string; icon: string; dot: string }> = {
  completed: {
    card: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-800/50 dark:bg-emerald-900/20',
    icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  active: {
    card: 'border-primary/40 bg-primary/5',
    icon: 'text-primary-foreground',
    dot: 'bg-primary animate-pulse',
  },
  pending: {
    card: 'border-border bg-card',
    icon: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/40',
  },
};

export function ProcessFlowCard() {
  return (
    <div
      className="bg-card border rounded-lg p-5 flex flex-col"
      style={{ borderColor: 'hsl(var(--card-border))' }}
      data-testid="process-flow-card"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Logistics Lifecycle</h3>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">SH1002 Flow</span>
      </div>

      <div className="flex flex-col gap-0">
        {steps.map((step, idx) => {
          const styles = statusStyles[step.status];
          const isLast = idx === steps.length - 1;

          return (
            <div key={step.id} className="flex flex-col items-center">
              {/* Step card */}
              <div
                className={`w-full rounded-lg border px-3 py-2 flex items-center gap-2.5 transition-all ${styles.card}`}
                data-testid={`flow-step-${step.id}`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                    step.status === 'active'
                      ? 'ring-4 ring-primary/20'
                      : ''
                  }`}
                  style={step.status === 'active' ? { backgroundColor: 'hsl(var(--primary))' } : undefined}
                >
                  <div className={step.status !== 'active' ? styles.icon : 'text-white'}>
                    {step.icon}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground leading-tight">{step.label}</p>
                  {step.sublabel && (
                    <p className="text-[10px] text-muted-foreground">{step.sublabel}</p>
                  )}
                  {step.isBranch && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 font-medium">
                        {step.branchYes}
                      </span>
                      <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 font-medium">
                        <RefreshCw className="w-2.5 h-2.5" />
                        {step.branchNo}
                      </span>
                    </div>
                  )}
                </div>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`} />
              </div>

              {/* Connector */}
              {!isLast && (
                <div className="flex flex-col items-center py-0.5">
                  <ArrowRight
                    className="w-3 h-3 rotate-90 text-muted-foreground/50"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
