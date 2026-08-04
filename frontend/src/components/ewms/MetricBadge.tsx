import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EwmsIntent } from '@/design-system/componentIntent';

const intentClass: Record<EwmsIntent, string> = {
  success: 'bg-[hsl(var(--vs-success)/0.12)] text-[hsl(var(--vs-success))]',
  warning: 'bg-[hsl(var(--vs-warning)/0.14)] text-[hsl(var(--vs-warning))]',
  danger: 'bg-[hsl(var(--destructive)/0.10)] text-destructive',
  info: 'bg-[hsl(var(--vs-info)/0.12)] text-[hsl(var(--vs-info))]',
  active: 'bg-[hsl(var(--primary)/0.10)] text-primary',
  draft: 'bg-muted text-foreground',
  neutral: 'bg-muted text-muted-foreground',
};

type MetricBadgeProps = {
  value: string | number;
  label?: string;
  intent?: EwmsIntent;
  trend?: 'up' | 'down' | 'none';
  className?: string;
};

export function MetricBadge({ value, label, intent = 'neutral', trend = 'none', className }: MetricBadgeProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : null;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', intentClass[intent], className)}>
      {TrendIcon && <TrendIcon className="size-3" aria-hidden="true" />}
      <span className="font-semibold">{value}</span>
      {label && <span>{label}</span>}
    </span>
  );
}
