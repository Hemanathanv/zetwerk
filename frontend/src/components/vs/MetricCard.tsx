import type { ElementType } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Package, Palette } from 'lucide-react';

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

// Side-stat value/label color, keyed by stat label — matches the design reference
// where each mini-stat reads in its own status color rather than plain foreground/muted.
const sideStatToneByLabel: Record<string, string> = {
  pending: 'hsl(var(--vs-warning))',
  blocked: 'hsl(var(--destructive))',
  blockers: 'hsl(var(--destructive))',
  completed: 'hsl(var(--vs-success))',
  active: 'hsl(var(--primary))',
  'd&d': 'hsl(var(--destructive))',
};

function sideStatColor(label: string): string {
  return sideStatToneByLabel[label.trim().toLowerCase()] ?? 'hsl(var(--foreground))';
}

// ─── KPI card fill variant (Mono Font Revert + Colored KPI Card Variant, Part 3) ──
// Scope: the Dashboard page's 7 `variant="dashboard"` cards ONLY — every other
// MetricCard consumer (Accounting, Inventory, Projects, ...) keeps the original
// minimal-card look untouched; that's out of this spec's scope.
// Light mode only — see --kpi-fill-* in index.css for the dark-mode fallback
// (colored fills resolve to the default card background in dark mode).

type KpiFill = 'default' | 'mint' | 'lavender' | 'peach' | 'blue';

const FILL_SWATCHES: { value: KpiFill; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'mint', label: 'Mint' },
  { value: 'lavender', label: 'Lavender' },
  { value: 'peach', label: 'Peach' },
  { value: 'blue', label: 'Blue' },
];

const FILL_VAR: Record<KpiFill, string> = {
  default: 'var(--kpi-fill-default)',
  mint: 'var(--kpi-fill-mint)',
  lavender: 'var(--kpi-fill-lavender)',
  peach: 'var(--kpi-fill-peach)',
  blue: 'var(--kpi-fill-blue)',
};

function isKpiFill(value: string | null): value is KpiFill {
  return !!value && value in FILL_VAR;
}

function useKpiFill(storageKey: string | null): [KpiFill, (next: KpiFill) => void] {
  const [fill, setFill] = useState<KpiFill>('default');

  useEffect(() => {
    if (!storageKey) return;
    const stored = window.localStorage.getItem(storageKey);
    if (isKpiFill(stored)) setFill(stored);
  }, [storageKey]);

  const update = (next: KpiFill) => {
    setFill(next);
    if (storageKey) window.localStorage.setItem(storageKey, next);
  };

  return [fill, update];
}

function FillPicker({ fill, onChange }: { fill: KpiFill; onChange: (next: KpiFill) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="absolute right-3 top-3 z-20 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
    >
      <button
        type="button"
        aria-label="Choose card color"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
        className="flex size-5 items-center justify-center rounded-md bg-card/80 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Palette className="size-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div
          onClick={e => { e.preventDefault(); e.stopPropagation(); }}
          className="absolute right-0 top-6 z-20 flex items-center gap-1.5 rounded-lg border border-card-border bg-popover p-2 shadow-lg"
        >
          {FILL_SWATCHES.map(opt => (
            <button
              key={opt.value}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              onClick={e => { e.preventDefault(); e.stopPropagation(); onChange(opt.value); setOpen(false); }}
              className="size-5 rounded-full border transition-transform hover:scale-110"
              style={{
                background: FILL_VAR[opt.value],
                borderColor: fill === opt.value ? 'hsl(var(--primary))' : '#C9C9C9',
                borderWidth: fill === opt.value ? 2 : 1,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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

  // Opt-in per card, saved locally — keyed by label since the 7 Dashboard cards are
  // stable/unique on that screen.
  const [fill, setFill] = useKpiFill(isDashboard ? `ewms-kpi-fill:${label}` : null);

  const cardBody = isDashboard ? (
    // ── Dashboard KPI card: keeps the live compact/responsive single-row sizing
    // (fixed 240x107 from spec 3.1 didn't fit label+number+sub-stats — reverted per
    // direct feedback). Radius/stroke/shadow/fill from 3.1 still apply.
    <div
      className="group relative flex size-full flex-col items-start gap-3 @max-[210px]:gap-2 p-6 @max-[210px]:p-4 @max-[160px]:p-3 text-card-foreground transition-shadow"
      style={{
        borderRadius: 16,
        background: FILL_VAR[fill],
        borderLeft: '1px solid #C9C9C9',
        borderBottom: '1px solid #C9C9C9',
        borderTop: 'none',
        borderRight: 'none',
        // Spec's literal shadow (9/13 + -6/14/42 spread:68) read as a visible halo
        // around each card at this size/gap — scaled down to a subtle lift instead.
        boxShadow: '0 2px 4px 0 rgba(0,0,0,0.04), -2px 5px 12px 0 rgba(0,0,0,0.05)',
      }}
      data-node-id="607:14563"
      data-name="KPI Card"
      data-kpi-fill={fill}
    >
      <FillPicker fill={fill} onChange={setFill} />
      <div className="flex w-full shrink-0 items-center gap-2 overflow-hidden">
        {Icon ? (
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
          <span className="shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-semibold leading-none text-destructive-foreground">
            {badge}
          </span>
        ) : null}
      </div>

      <span className="data-metric-value-lg shrink-0 whitespace-nowrap text-foreground">
        {value}
      </span>

      {resolvedSideStats.length > 0 ? (
        <div className="flex w-full shrink-0 flex-col items-start">
          <div className="h-px w-full shrink-0 bg-border" />
          <div className="flex w-full flex-col pt-3 @max-[210px]:pt-2 gap-1">
            {resolvedSideStats.map((stat) => {
              const toneColor = sideStatColor(stat.label);
              return (
                <div key={`${stat.label}-${stat.value}`} className="flex items-center gap-1">
                  <span className="text-[13px] @max-[210px]:text-[12px] font-semibold" style={{ color: toneColor }}>
                    {stat.value}
                  </span>
                  <span className="text-[11px] @max-[210px]:text-[10px]" style={{ color: toneColor }}>
                    {stat.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  ) : (
    // ── Minimal card (Accounting / Inventory / Projects / ...): unchanged from
    // before this spec — out of scope, left exactly as it was.
    <div
      className="group relative flex size-full flex-col items-start gap-3 @max-[210px]:gap-2 rounded-3xl border border-card-border bg-card p-6 @max-[210px]:p-4 @max-[160px]:p-3 text-card-foreground transition-shadow hover:shadow-md"
      data-node-id="607:14563"
      data-name="KPI Card"
    >
      <div className="flex w-full shrink-0 items-center gap-2 overflow-hidden">
        <span className="min-w-0 flex-1 truncate text-[13px] @max-[210px]:text-[12px] font-medium leading-[1.4] text-foreground">
          {label}
        </span>
      </div>

      <span className="shrink-0 whitespace-nowrap text-[26px] @max-[210px]:text-[20px] @max-[160px]:text-[16px] font-semibold leading-[1.1] tracking-normal text-foreground tabular-nums">
        {value}
      </span>

      {resolvedSideStats.length > 0 ? (
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
