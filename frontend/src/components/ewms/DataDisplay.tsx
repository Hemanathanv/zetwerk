import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { ProgressBar } from '@/components/vs/ProgressBar';
import { StatusIndicator } from './StatusIndicator';
import { cn } from '@/lib/utils';

export function HeaderCell({ children, align = 'left', className }: { children: ReactNode; align?: 'left' | 'right'; className?: string }) {
  return (
    <div className={cn('bg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground', align === 'right' && 'text-right', className)}>
      {children}
    </div>
  );
}

export function DataCell({ children, type = 'auto', numeric = false, className }: { children: ReactNode; type?: 'auto' | 'calculated' | 'input'; numeric?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        'min-h-10 px-3 py-2 text-sm text-foreground',
        numeric && 'text-right tabular-nums',
        type === 'calculated' && 'font-semibold',
        type === 'input' && 'rounded-md border border-primary bg-background',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TableHeaderRow({ columns }: { columns: Array<{ key: string; label: ReactNode; align?: 'left' | 'right' }> }) {
  return (
    <div className="grid border-b border-border" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
      {columns.map((column) => <HeaderCell key={column.key} align={column.align}>{column.label}</HeaderCell>)}
    </div>
  );
}

export function TableRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid border-b border-border bg-card hover:bg-muted/40', className)}>{children}</div>;
}

export function ListCell({
  kind = 'stacked-text',
  primary,
  secondary,
  status,
  metric,
  progress,
  action,
}: {
  kind?: 'stacked-text' | 'badge' | 'progress' | 'metric' | 'date' | 'action' | 'chevron';
  primary?: ReactNode;
  secondary?: ReactNode;
  status?: string;
  metric?: ReactNode;
  progress?: { current: number; total: number };
  action?: ReactNode;
}) {
  if (kind === 'badge' && status) return <StatusIndicator status={status} />;
  if (kind === 'progress' && progress) return <ProgressBar current={progress.current} total={progress.total} valueDisplay="percentage" hasLabel={false} />;
  if (kind === 'metric') return <div className="text-right text-sm tabular-nums">{metric ?? primary}</div>;
  if (kind === 'action') return <div className="text-right">{action}</div>;
  if (kind === 'chevron') return <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />;
  return (
    <div className="min-w-0">
      <div className="truncate text-sm font-medium text-foreground">{primary}</div>
      {secondary && <div className="truncate text-xs text-muted-foreground">{secondary}</div>}
    </div>
  );
}

export function ListRow({ children, onClick, className, style }: { children: ReactNode; onClick?: () => void; className?: string; style?: CSSProperties }) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      className={cn('grid min-h-14 items-center gap-3 border-b border-border bg-card px-4 py-3 hover:bg-muted/40', onClick && 'cursor-pointer', className)}
      style={style}
    >
      {children}
    </div>
  );
}

export function ListHeaderRow({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={cn('grid gap-3 border-b border-border bg-muted px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground', className)} style={style}>{children}</div>;
}
