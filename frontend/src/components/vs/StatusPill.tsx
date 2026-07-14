type PillVariant =
  | 'transit'
  | 'port'
  | 'cleared'
  | 'blocked'
  | 'validated'
  | 'pending'
  | 'warning'
  | 'danger'
  | 'success'
  | 'info';

type StatusPillProps = {
  status: string;
  variant: PillVariant;
};

const variantStyles: Record<PillVariant, { bg: string; color: string }> = {
  transit: {
    bg:    'hsla(201, 96%, 32%, 0.10)',
    color: 'hsl(201 96% 28%)',
  },
  port: {
    bg:    'hsla(38, 92%, 50%, 0.12)',
    color: 'hsl(38 92% 38%)',
  },
  cleared: {
    bg:    'hsla(152, 69%, 31%, 0.10)',
    color: 'hsl(152 69% 25%)',
  },
  blocked: {
    bg:    'hsla(0, 84%, 60%, 0.10)',
    color: 'hsl(0 84% 45%)',
  },
  validated: {
    bg:    'hsla(152, 69%, 31%, 0.10)',
    color: 'hsl(152 69% 25%)',
  },
  pending: {
    bg:    'hsl(var(--muted))',
    color: 'hsl(var(--muted-foreground))',
  },
  warning: {
    bg:    'hsla(38, 92%, 50%, 0.12)',
    color: 'hsl(38 92% 38%)',
  },
  danger: {
    bg:    'hsla(0, 84%, 60%, 0.10)',
    color: 'hsl(0 84% 45%)',
  },
  success: {
    bg:    'hsla(152, 69%, 31%, 0.10)',
    color: 'hsl(152 69% 25%)',
  },
  info: {
    bg:    'hsla(201, 96%, 32%, 0.10)',
    color: 'hsl(201 96% 28%)',
  },
};

export function StatusPill({ status, variant }: StatusPillProps) {
  const { bg, color } = variantStyles[variant];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 14.5,
        fontWeight: 500,
        backgroundColor: bg,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}
