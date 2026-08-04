import type { ElementType } from 'react';
import { Package } from 'lucide-react';

type MetricCardProps = {
  label: string;
  value: string | number;
  variant?: 'dashboard' | 'minimal';
  icon?: ElementType | null;
  color?: 'teal' | 'success' | 'warning' | 'danger' | 'info' | 'blue' | 'amber' | 'red' | 'green';
  href?: string;
  badge?: string;
  subText?: string;
  subTextColor?: unknown;
  accentColor?: unknown;
  sideStats?: Array<{ value: string | number; label: string }>;
};

const toneStyles = {
  teal: {
    bg: 'hsl(var(--primary) / 0.12)',
    color: 'hsl(var(--primary))',
  },
  success: {
    bg: 'hsl(var(--vs-success) / 0.12)',
    color: 'hsl(var(--vs-success))',
  },
  warning: {
    bg: 'hsl(var(--vs-warning) / 0.14)',
    color: 'hsl(var(--vs-warning))',
  },
  danger: {
    bg: 'hsl(var(--destructive) / 0.12)',
    color: 'hsl(var(--destructive))',
  },
  info: {
    bg: 'hsl(var(--vs-info) / 0.12)',
    color: 'hsl(var(--vs-info))',
  },
  blue: {
    bg: 'hsl(var(--vs-info) / 0.12)',
    color: 'hsl(var(--vs-info))',
  },
  amber: {
    bg: 'hsl(var(--vs-warning) / 0.14)',
    color: 'hsl(var(--vs-warning))',
  },
  red: {
    bg: 'hsl(var(--destructive) / 0.12)',
    color: 'hsl(var(--destructive))',
  },
  green: {
    bg: 'hsl(var(--vs-success) / 0.12)',
    color: 'hsl(var(--vs-success))',
  },
} satisfies Record<NonNullable<MetricCardProps['color']>, { bg: string; color: string }>;

export function MetricCard({
  label,
  value,
  variant = 'minimal',
  icon: Icon = Package,
  color = 'teal',
  href,
  badge,
  subText,
  sideStats,
}: MetricCardProps) {
  const resolvedSideStats = sideStats ?? (subText ? [{ value: subText, label: '' }] : []);
  const tone = toneStyles[color] ?? toneStyles.teal;
  const isDashboard = variant === 'dashboard';

  const content = (
    <div
      className="group relative flex size-full flex-col items-start gap-3 rounded-lg border border-card-border bg-card p-6 text-card-foreground transition-shadow hover:shadow-md"
      data-node-id="607:14563"
      data-name="KPI Card"
    >
      <div className="flex w-full shrink-0 items-center gap-2 overflow-hidden">
        {isDashboard && Icon ? (
          <span
            className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md"
            style={{ backgroundColor: tone.bg }}
          >
            <Icon className="size-4" style={{ color: tone.color }} strokeWidth={1.75} aria-hidden="true" />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-[1.4] text-foreground">
          {label}
        </span>
        {badge ? (
          <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-semibold leading-none text-destructive-foreground">
            {badge}
          </span>
        ) : null}
      </div>

      <span className="shrink-0 whitespace-nowrap text-[26px] font-semibold leading-[1.1] tracking-normal text-foreground">
        {value}
      </span>

      {isDashboard && resolvedSideStats.length > 0 ? (
        <div className="flex w-full shrink-0 flex-col items-start overflow-hidden">
          <div className="h-px w-full shrink-0 bg-border" />
          <div className="flex w-full shrink-0 items-start gap-4 overflow-hidden pt-3 whitespace-nowrap">
            {resolvedSideStats.slice(0, 2).map((stat) => (
              <div key={`${stat.label}-${stat.value}`} className="flex shrink-0 items-center gap-1 overflow-hidden">
                <span className="text-[13px] font-semibold leading-normal text-foreground">{stat.value}</span>
                {stat.label && (
                  <span className="text-[11px] font-normal leading-[1.3] text-muted-foreground">{stat.label}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  return href ? (
    <a href={href} className="block size-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {content}
    </a>
  ) : content;
}
