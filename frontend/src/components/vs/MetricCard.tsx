type AccentColor = 'teal' | 'info' | 'warning' | 'danger' | 'success';
type SubTextColor = 'success' | 'danger' | 'warning' | 'muted';

type MetricCardProps = {
  label: string;
  value: string | number;
  subText?: string;
  subTextColor?: SubTextColor;
  accentColor?: AccentColor;
};

const accentMap: Record<AccentColor, string> = {
  teal:    'hsl(var(--vs-teal))',
  info:    'hsl(var(--vs-info))',
  warning: 'hsl(var(--vs-warning))',
  danger:  'hsl(var(--vs-danger))',
  success: 'hsl(var(--vs-success))',
};

const subTextMap: Record<SubTextColor, string> = {
  success: 'hsl(var(--vs-success))',
  danger:  'hsl(var(--vs-danger))',
  warning: 'hsl(var(--vs-warning))',
  muted:   'hsl(var(--muted-foreground))',
};

export function MetricCard({
  label,
  value,
  subText,
  subTextColor = 'muted',
  accentColor = 'teal',
}: MetricCardProps) {
  return (
    <div
      className="relative bg-card rounded-xl px-5 py-4 flex flex-col gap-1 transition-all duration-200 cursor-default"
      style={{
        boxShadow: 'var(--vs-shadow-card)',
        borderLeft: `3px solid ${accentMap[accentColor]}`,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--vs-shadow-elevated)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = '';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--vs-shadow-card)';
      }}
    >
      <span
        className="uppercase font-medium tracking-widest"
        style={{ fontSize: 11, letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))' }}
      >
        {label}
      </span>

      <span
        className="vs-mono font-semibold leading-none"
        style={{ fontSize: 28, letterSpacing: '-0.02em', color: 'hsl(var(--foreground))' }}
      >
        {value}
      </span>

      {subText && (
        <span
          className="text-xs font-medium"
          style={{ color: subTextMap[subTextColor] }}
        >
          {subText}
        </span>
      )}
    </div>
  );
}
