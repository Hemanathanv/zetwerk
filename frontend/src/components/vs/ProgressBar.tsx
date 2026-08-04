import type { EwmsIntent } from '@/design-system/componentIntent';

type ProgressBarProps = {
  current?: number;
  total?: number;
  variant?: 'default' | 'danger';
  intent?: EwmsIntent;
  label?: string;
  value?: string;
  valueDisplay?: 'percentage' | 'ratio' | 'none';
  size?: 'default' | 'sm';
  hasLabel?: boolean;
  hasSegmentedFill?: boolean;
  secondaryValue?: number;
};

const intentColor: Record<EwmsIntent | 'default', string> = {
  default: 'hsl(var(--primary))',
  success: 'hsl(var(--vs-success))',
  warning: 'hsl(var(--vs-warning))',
  danger: 'hsl(var(--destructive))',
  info: 'hsl(var(--vs-info))',
  active: 'hsl(var(--primary))',
  draft: 'hsl(var(--foreground))',
  neutral: 'hsl(var(--muted-foreground))',
};

export function ProgressBar({
  current = 0,
  total = 100,
  variant = 'default',
  intent,
  label = 'Progress',
  value,
  valueDisplay = 'ratio',
  size = 'default',
  hasLabel,
  hasSegmentedFill = false,
  secondaryValue = 0,
}: ProgressBarProps) {
  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  const secondaryPct = total > 0 ? Math.min(100 - pct, (secondaryValue / total) * 100) : 0;
  const resolvedIntent = intent ?? (variant === 'danger' ? 'danger' : 'default');
  const barHeight = size === 'sm' ? 4 : 8;
  const shouldShowLabel = hasLabel ?? valueDisplay !== 'ratio';
  const displayValue = value ?? (
    valueDisplay === 'percentage'
      ? `${Math.round(pct)}%`
      : valueDisplay === 'ratio'
        ? `${current}/${total}`
        : ''
  );

  return (
    <div className={shouldShowLabel ? 'flex flex-col gap-1.5' : 'flex items-center gap-2'}>
      {shouldShowLabel && (
        <div className="flex items-center justify-between gap-3 text-[12px] font-medium leading-[1.4] tracking-normal">
          <span className="text-foreground">{label}</span>
          {valueDisplay !== 'none' && <span className="text-muted-foreground">{displayValue}</span>}
        </div>
      )}
      <div
        style={{
          width: '100%',
          flex: shouldShowLabel ? undefined : 1,
          height: barHeight,
          borderRadius: 999,
          backgroundColor: 'hsl(var(--border))',
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: 999,
            background: intentColor[resolvedIntent],
            transition: 'width 0.3s ease',
          }}
        />
        {hasSegmentedFill && secondaryPct > 0 && (
          <div
            style={{
              height: '100%',
              width: `${secondaryPct}%`,
              background: intentColor.danger,
              transition: 'width 0.3s ease',
            }}
          />
        )}
      </div>
      {!shouldShowLabel && valueDisplay !== 'none' && (
        <span
          className="vs-mono shrink-0 text-right font-medium text-muted-foreground"
          style={{ fontSize: 14.5, minWidth: 34 }}
        >
          {displayValue}
        </span>
      )}
    </div>
  );
}
