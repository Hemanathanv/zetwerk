type Status = 'active' | 'inactive' | 'draft' | 'archived' | 'system' | 'custom';

interface AdminStatusBadgeProps {
  status: Status;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<Status, { bg: string; text: string; label: string }> = {
  active:   { bg: '#dcfce7', text: '#166534', label: 'Active'   },
  inactive: { bg: '#f1f5f9', text: '#64748b', label: 'Inactive' },
  draft:    { bg: '#fef9c3', text: '#854d0e', label: 'Draft'    },
  archived: { bg: '#f1f5f9', text: '#94a3b8', label: 'Archived' },
  system:   { bg: '#dbeafe', text: '#1e40af', label: 'System'   },
  custom:   { bg: 'hsla(173,58%,39%,0.12)', text: 'hsl(173 58% 30%)', label: 'Custom' },
};

export function AdminStatusBadge({ status, size = 'md' }: AdminStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.inactive;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: size === 'sm' ? '2px 8px' : '3px 12px',
        borderRadius: 99,
        fontSize: size === 'sm' ? 12 : 13,
        fontWeight: 600,
        background: cfg.bg,
        color: cfg.text,
        lineHeight: 1.6,
        whiteSpace: 'nowrap',
      }}
    >
      {cfg.label}
    </span>
  );
}
