import type { ReactNode } from 'react';

type BadgeVariant = 'teal' | 'gold';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  badge?: { label: string; variant: BadgeVariant };
  actions?: ReactNode;
};

const badgeStyles: Record<BadgeVariant, { bg: string; color: string; dot: string }> = {
  teal: {
    bg:    'hsla(173, 58%, 39%, 0.10)',
    color: 'hsl(var(--vs-teal-dark))',
    dot:   'hsl(var(--vs-teal))',
  },
  gold: {
    bg:    'hsla(43, 96%, 56%, 0.15)',
    color: 'hsl(38 92% 30%)',
    dot:   'hsl(var(--vs-gold))',
  },
};

export function PageHeader({ title, subtitle, badge, actions }: PageHeaderProps) {
  return (
    <div
      className="flex items-start justify-between"
      style={{ marginBottom: 24 }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2
            className="leading-tight"
            style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))' }}
          >
            {title}
          </h2>
          {badge && (
            <span
              className="flex items-center gap-1.5 font-medium"
              style={{
                padding: '5px 12px',
                borderRadius: 999,
                fontSize: 14,
                backgroundColor: badgeStyles[badge.variant].bg,
                color: badgeStyles[badge.variant].color,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: badgeStyles[badge.variant].dot,
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              {badge.label}
            </span>
          )}
        </div>
        {subtitle && (
          <p style={{ fontSize: 'var(--text-subtitle-size)', color: 'hsl(var(--muted-foreground))' }}>
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center flex-shrink-0" style={{ gap: 8 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
