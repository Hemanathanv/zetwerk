import { Badge } from '@/components/ui/badge';

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  badge?: { label: string; count: number };
  actions?: React.ReactNode;
}

export function AdminPageHeader({ title, description, badge, actions }: AdminPageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingBottom: 20,
        marginBottom: 24,
        borderBottom: '1px solid hsl(var(--border))',
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1
            style={{
              fontSize: 'var(--text-admin-title-size)',
              fontWeight: 'var(--text-admin-title-weight)',
              letterSpacing: '-0.025em',
              color: 'hsl(var(--foreground))',
              margin: 0,
            }}
          >
            {title}
          </h1>
          {badge && (
            <div className="flex items-center gap-1.5">
              <Badge intent="active" size="sm">{badge.count}</Badge>
              <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                {badge.label}
              </span>
            </div>
          )}
        </div>
        {description && (
          <p
            style={{
              fontSize: 14.5,
              color: 'hsl(var(--muted-foreground))',
              marginTop: 6,
              marginBottom: 0,
            }}
          >
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
