import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

type BadgeVariant = 'teal' | 'gold';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  badge?: { label: string; variant: BadgeVariant };
  actions?: ReactNode;
};

const badgeIntent: Record<BadgeVariant, 'active' | 'warning'> = {
  teal: 'active',
  gold: 'warning',
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
            <Badge intent={badgeIntent[badge.variant]} size="sm" hasDot>
              {badge.label}
            </Badge>
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
