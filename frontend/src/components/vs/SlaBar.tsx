type SlaVariant = 'ok' | 'warning' | 'critical';

type SlaBarProps = {
  percentElapsed: number;
  timeRemaining: string;
  variant?: SlaVariant;
};

function autoVariant(pct: number): SlaVariant {
  if (pct >= 100) return 'critical';
  if (pct >= 75)  return 'warning';
  return 'ok';
}

const fillColors: Record<SlaVariant, string> = {
  ok:       'hsl(var(--vs-teal))',
  warning:  'hsl(var(--vs-warning))',
  critical: 'hsl(var(--vs-danger))',
};

const textColors: Record<SlaVariant, string> = {
  ok:       'hsl(var(--muted-foreground))',
  warning:  'hsl(var(--vs-warning))',
  critical: 'hsl(var(--vs-danger))',
};

export function SlaBar({ percentElapsed, timeRemaining, variant }: SlaBarProps) {
  const v = variant ?? autoVariant(percentElapsed);
  const clampedPct = Math.min(100, Math.max(0, percentElapsed));

  return (
    <div className="flex flex-col gap-1">
      <div
        style={{
          width: 130,
          height: 5,
          borderRadius: 999,
          backgroundColor: 'hsl(var(--border))',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${clampedPct}%`,
            borderRadius: 999,
            backgroundColor: fillColors[v],
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span
        className="vs-mono font-bold"
        style={{ fontSize: 14, color: textColors[v] }}
      >
        {timeRemaining}
      </span>
    </div>
  );
}
