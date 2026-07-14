import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface AdminFormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  isLast?: boolean;
}

export function AdminFormSection({
  title, description, children,
  collapsible = false, defaultOpen = true, isLast = false,
}: AdminFormSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        paddingBottom: isLast ? 0 : 20,
        marginBottom: isLast ? 0 : 20,
        borderBottom: isLast ? 'none' : '1px solid hsl(var(--border))',
      }}
    >
      <div
        onClick={() => collapsible && setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
          cursor: collapsible ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        {collapsible && (
          <span style={{ color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
        <div>
          <div
            style={{
              fontSize: 13,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
              color: 'hsl(var(--muted-foreground))',
            }}
          >
            {title}
          </div>
          {description && (
            <div
              style={{
                fontSize: 14,
                color: 'hsl(var(--muted-foreground))',
                marginTop: 2,
              }}
            >
              {description}
            </div>
          )}
        </div>
      </div>
      {(!collapsible || open) && (
        <div style={{ marginTop: 12 }}>{children}</div>
      )}
    </div>
  );
}
