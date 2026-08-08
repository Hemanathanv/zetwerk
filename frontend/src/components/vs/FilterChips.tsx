import { cn } from '@/lib/utils';

type Chip = {
  label: string;
  count?: number;
};

type FilterChipsSize = 'default' | 'compact';

type FilterChipsProps = {
  chips: Chip[];
  activeIndex: number;
  onSelect: (index: number) => void;
  className?: string;
  /** 'compact' shrinks font/padding and forces a single non-wrapping row (scrolls if it
   * genuinely can't fit) — opt-in only, 'default' preserves the original look/behavior. */
  size?: FilterChipsSize;
};

export function FilterChips({ chips, activeIndex, onSelect, className, size = 'default' }: FilterChipsProps) {
  const isCompact = size === 'compact';
  return (
    <div
      className={cn(
        'inline-flex max-w-full items-center rounded-full bg-muted p-0.5',
        isCompact ? 'flex-nowrap overflow-x-auto' : 'flex-wrap',
        className,
      )}
      style={isCompact ? { scrollbarWidth: 'thin' } : undefined}
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
              'shrink-0 whitespace-nowrap rounded-full font-medium transition-colors',
              isCompact ? 'h-8 px-2.5 text-xs' : 'h-10 px-4 text-sm',
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
