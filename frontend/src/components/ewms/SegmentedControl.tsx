import { cn } from '@/lib/utils';

export type SegmentOption = {
  value: string;
  label: string;
};

type SegmentedControlProps = {
  options: SegmentOption[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
};

export function SegmentedControl({ options, value, onValueChange, className }: SegmentedControlProps) {
  return (
    <div
      className={cn('inline-flex max-w-full flex-wrap items-center rounded-full bg-muted p-0.5', className)}
      role="tablist"
      aria-label="Segmented options"
    >
      {options.slice(0, 8).map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onValueChange(option.value)}
          className={cn(
            'h-10 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
            value === option.value
              ? 'border border-border bg-card text-primary shadow-sm'
              : 'border border-transparent bg-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
