import { cn } from '@/lib/utils';

type Chip = {
  label: string;
  count?: number;
};

type FilterChipsProps = {
  chips: Chip[];
  activeIndex: number;
  onSelect: (index: number) => void;
  className?: string;
};

export function FilterChips({ chips, activeIndex, onSelect, className }: FilterChipsProps) {
  return (
    <div
      className={cn(
        'inline-flex max-w-full flex-wrap items-center rounded-full bg-muted p-0.5',
        className,
      )}
      role="tablist"
      aria-label="Filter options"
    >
      {chips.map((chip, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(i)}
            className={cn(
              'h-10 shrink-0 rounded-full px-4 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              isActive
                ? 'border border-border bg-card text-primary shadow-sm'
                : 'border border-transparent bg-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {chip.label}
            {chip.count !== undefined && (
              <span className={cn('ml-1', isActive ? 'text-primary/75' : 'text-muted-foreground/70')}>
                ({chip.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
