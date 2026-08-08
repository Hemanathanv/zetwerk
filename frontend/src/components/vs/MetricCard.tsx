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

  const cardBody = (
    <div
      className="group relative flex size-full flex-col items-start gap-3 @max-[210px]:gap-2 rounded-3xl border border-card-border bg-card p-6 @max-[210px]:p-4 @max-[160px]:p-3 text-card-foreground transition-shadow hover:shadow-md"
      data-node-id="607:14563"
      data-name="KPI Card"
    >
      <div className="flex w-full shrink-0 items-center gap-2 overflow-hidden">
        {isDashboard && Icon ? (
          <span
            className="flex size-6 @max-[210px]:size-5 shrink-0 items-center justify-center overflow-hidden rounded-md"
            style={{ backgroundColor: tone.bg }}
          >
            <Icon className="size-4 @max-[210px]:size-3.5" style={{ color: tone.color }} strokeWidth={1.75} aria-hidden="true" />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[13px] @max-[210px]:text-[12px] font-medium leading-[1.4] text-foreground">
          {label}
        </span>
        {badge ? (
          <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-semibold leading-none text-destructive-foreground">
            {badge}
          </span>
        ) : null}
      </div>

      <span className="shrink-0 whitespace-nowrap text-[26px] @max-[210px]:text-[20px] @max-[160px]:text-[16px] font-semibold leading-[1.1] tracking-normal text-foreground tabular-nums">
        {value}
      </span>

      {isDashboard && resolvedSideStats.length > 0 ? (
        <div className="flex w-full shrink-0 flex-col items-start">
          <div className="h-px w-full shrink-0 bg-border" />
            <div className="flex w-full flex-col pt-3 @max-[210px]:pt-2 gap-1">
              {resolvedSideStats.map((stat) => (
                <div
                  key={`${stat.label}-${stat.value}`}
                  className="flex items-center gap-1"
                >
                  <span className="text-[13px] @max-[210px]:text-[12px] font-semibold text-foreground">
                    {stat.value}
                  </span>

                  <span className="text-[11px] @max-[210px]:text-[10px] text-muted-foreground">
                    {stat.label}
                  </span>
                </div>
              ))}
            </div>
        </div>
      ) : null}
    </div>
  );

  const content = <div className="@container size-full">{cardBody}</div>;

  return href ? (
    <a href={href} className="block size-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {content}
    </a>
  ) : content;
}
