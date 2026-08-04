import * as LucideIcons from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AdminEmptyStateProps {
  icon: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function AdminEmptyState({ icon, title, description, actionLabel, onAction }: AdminEmptyStateProps) {
  const IconComponent = (LucideIcons as any)[icon] as React.ElementType | undefined;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 60,
        textAlign: 'center',
      }}
    >
      {IconComponent && (
        <IconComponent
          size={48}
          style={{ color: 'hsl(var(--muted-foreground))', opacity: 0.5 }}
        />
      )}
      <h3
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: 'hsl(var(--foreground))',
          marginTop: 16,
          marginBottom: 0,
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: 14.5,
          color: 'hsl(var(--muted-foreground))',
          marginTop: 8,
          maxWidth: 400,
          lineHeight: 1.6,
        }}
      >
        {description}
      </p>
      {actionLabel && onAction && (
        <Button size="sm" onClick={onAction} style={{ marginTop: 20 }}>
          {actionLabel}
        </Button>
      )}
      {actionLabel && !onAction && (
        <Button size="sm" disabled style={{ marginTop: 20, opacity: 0.5 }}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
