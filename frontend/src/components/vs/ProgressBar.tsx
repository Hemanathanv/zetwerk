type ProgressBarVariant = 'default' | 'danger';

type ProgressBarProps = {
  current: number;
  total: number;
  variant?: ProgressBarVariant;
};

const gradients: Record<ProgressBarVariant, string> = {
  default: 'linear-gradient(90deg, hsl(var(--vs-teal)), hsl(173 58% 45%))',
  danger:  'linear-gradient(90deg, hsl(var(--vs-danger)), hsl(0 75% 55%))',
};

export function ProgressBar({ current, total, variant = 'default' }: ProgressBarProps) {
  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  return (
    <div className="flex items-center" style={{ gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 999,
          backgroundColor: 'hsl(var(--border))',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: 999,
            background: gradients[variant],
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span
        className="vs-mono font-medium text-right flex-shrink-0"
        style={{
          fontSize: 14.5,
          minWidth: 34,
          color: 'hsl(var(--muted-foreground))',
        }}
      >
        {current}/{total}
      </span>
    </div>
  );
}
