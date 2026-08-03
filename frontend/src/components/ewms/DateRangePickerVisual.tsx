import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function DateRangeTrigger({ label = 'YTD', open = false, className }: { label?: string; open?: boolean; className?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" className={cn('gap-2', open && 'border-primary ring-1 ring-primary', className)}>
      <CalendarDays className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}

export function DayCell({ day, state = 'default' }: { day: number; state?: 'default' | 'today' | 'selected' | 'range-middle' | 'disabled' }) {
  return (
    <button
      type="button"
      disabled={state === 'disabled'}
      className={cn(
        'grid size-8 place-items-center rounded-md text-sm',
        state === 'today' && 'border border-primary text-primary',
        state === 'selected' && 'bg-primary text-primary-foreground',
        state === 'range-middle' && 'bg-[hsl(var(--primary)/0.10)] text-primary',
        state === 'disabled' && 'text-muted-foreground opacity-40',
      )}
    >
      {day}
    </button>
  );
}

export function CalendarPanel() {
  return (
    <div className="w-72 rounded-lg border border-border bg-popover p-3 shadow-md">
      <div className="mb-3 text-sm font-medium">July 2026</div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <div key={`${day}-${index}`}>{day}</div>)}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {Array.from({ length: 31 }, (_, index) => (
          <DayCell key={index + 1} day={index + 1} state={index + 1 === 31 ? 'today' : index + 1 === 15 ? 'selected' : 'default'} />
        ))}
      </div>
    </div>
  );
}

export function DateRangePickerOpen() {
  return (
    <div className="inline-flex flex-col gap-2">
      <DateRangeTrigger label="Jul 1 - Jul 31" open />
      <CalendarPanel />
    </div>
  );
}
