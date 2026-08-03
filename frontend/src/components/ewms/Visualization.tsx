import type { ReactNode } from 'react';
import { Boxes, Circle, Container, Package, Ship } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EwmsIntent } from '@/design-system/componentIntent';

export type StepStatus = 'completed' | 'active' | 'hold' | 'cancelled' | 'upcoming' | 'overdue';

const stepColor: Record<StepStatus, string> = {
  completed: 'border-[hsl(var(--vs-success))] bg-[hsl(var(--vs-success))] text-white',
  active: 'border-[hsl(var(--vs-success))] bg-card text-[hsl(var(--vs-success))] ring-2 ring-[hsl(var(--vs-success)/0.20)]',
  hold: 'border-[hsl(var(--vs-warning))] bg-[hsl(var(--vs-warning)/0.12)] text-[hsl(var(--vs-warning))]',
  cancelled: 'border-destructive bg-[hsl(var(--destructive)/0.10)] text-destructive',
  upcoming: 'border-border bg-card text-muted-foreground',
  overdue: 'border-border bg-card text-muted-foreground',
};

const connectorColor: Record<StepStatus, string> = {
  completed: 'bg-[hsl(var(--vs-success))]',
  active: 'bg-[hsl(var(--vs-success))]',
  hold: 'bg-[hsl(var(--vs-warning))]',
  cancelled: 'bg-destructive',
  upcoming: 'bg-border',
  overdue: 'bg-border',
};

export function StepNode({ status = 'upcoming', label }: { status?: StepStatus; label?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={cn('grid size-6 place-items-center rounded-full border text-[11px] font-semibold', stepColor[status])}>
        {status === 'completed' ? '✓' : status === 'active' ? <Circle className="size-2 fill-current" /> : ''}
      </span>
      {label && <span className="max-w-20 truncate text-xs text-muted-foreground">{label}</span>}
    </div>
  );
}

export function StepRow({ title, description, timestamp, status = 'upcoming' }: { title: ReactNode; description?: ReactNode; timestamp?: ReactNode; status?: StepStatus }) {
  return (
    <div className="flex gap-3">
      <StepNode status={status} />
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm font-medium">{title}</div>
          {timestamp && <div className="shrink-0 text-xs text-muted-foreground">{timestamp}</div>}
        </div>
        {description && <div className="mt-1 text-xs text-muted-foreground">{description}</div>}
      </div>
    </div>
  );
}

export function StepperHorizontal({ steps }: { steps: Array<{ label: ReactNode; status: StepStatus }> }) {
  const visibleSteps = steps.slice(0, 7);
  return (
    <div className="flex w-full items-start">
      {visibleSteps.map((step, index) => (
        <div key={index} className="flex min-w-0 flex-1 items-start last:flex-none">
          <StepNode status={step.status} label={step.label} />
          {index < visibleSteps.length - 1 && (
            <div className={cn('mt-3 h-px min-w-6 flex-1', connectorColor[visibleSteps[index + 1].status])} />
          )}
        </div>
      ))}
    </div>
  );
}

export function GateNode({ completed = false, label }: { completed?: boolean; label: ReactNode }) {
  return <span className={cn('grid size-6 place-items-center rounded-full text-[11px] font-semibold', completed ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{label}</span>;
}

export function GateIndicator({ gates = [true, true, false, false, false] }: { gates?: boolean[] }) {
  return (
    <div className="flex items-center gap-1">
      {gates.slice(0, 5).map((completed, index) => <GateNode key={index} completed={completed} label={`G${index + 1}`} />)}
    </div>
  );
}

export function GateHealthCard({ title, active, blocked }: { title: ReactNode; active: number; blocked: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 text-sm font-medium">{title}</div>
      <div className="grid gap-3">
        {[{ icon: Container, label: 'Container' }, { icon: Package, label: 'Break-bulk' }].map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm text-muted-foreground"><row.icon className="size-4" />{row.label}</span>
            <span className="flex items-center gap-3 text-sm tabular-nums">
              <span className="font-semibold text-[hsl(var(--vs-success))]">{active}</span>
              <span className="font-semibold text-destructive">{blocked}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const iconTileClass: Record<EwmsIntent, string> = {
  success: 'bg-[hsl(var(--vs-success)/0.12)] text-[hsl(var(--vs-success))]',
  warning: 'bg-[hsl(var(--vs-warning)/0.14)] text-[hsl(var(--vs-warning))]',
  danger: 'bg-[hsl(var(--destructive)/0.10)] text-destructive',
  info: 'bg-[hsl(var(--vs-info)/0.12)] text-[hsl(var(--vs-info))]',
  active: 'bg-[hsl(var(--primary)/0.10)] text-primary',
  draft: 'bg-muted text-foreground',
  neutral: 'bg-muted text-muted-foreground',
};

export function IconTile({ icon: Icon = Boxes, intent = 'info' }: { icon?: typeof Boxes; intent?: EwmsIntent }) {
  return <span className={cn('grid size-8 place-items-center rounded-md', iconTileClass[intent])}><Icon className="size-4" aria-hidden="true" /></span>;
}

export function ColumnLegendDot({ intent = 'neutral' }: { intent?: EwmsIntent }) {
  return <span className={cn('inline-block size-2 rounded-full', iconTileClass[intent])} />;
}

export function IconBadge({ icon: Icon = Ship, label, intent = 'info' }: { icon?: typeof Ship; label?: ReactNode; intent?: EwmsIntent }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', iconTileClass[intent])}><Icon className="size-3.5" />{label}</span>;
}
