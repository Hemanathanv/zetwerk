import type { ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type FilterChipProps = {
  children: ReactNode;
  active?: boolean;
  onRemove?: () => void;
  className?: string;
};

export function FilterChip({ children, active = false, onRemove, className }: FilterChipProps) {
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
        active ? 'border-primary bg-[hsl(var(--primary)/0.10)] text-primary' : 'border-border bg-card text-muted-foreground',
        className,
      )}
    >
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="rounded-full p-0.5 hover:bg-muted" aria-label="Remove filter">
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

type FilterTriggerProps = {
  children?: ReactNode;
  activeCount?: number;
  onClick?: () => void;
  className?: string;
};

export function FilterTrigger({ children = 'Filters', activeCount = 0, onClick, className }: FilterTriggerProps) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} className={cn('gap-2', className)}>
      <SlidersHorizontal className="size-4" aria-hidden="true" />
      {children}
      {activeCount > 0 && (
        <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary-foreground">
          {activeCount}
        </span>
      )}
    </Button>
  );
}
