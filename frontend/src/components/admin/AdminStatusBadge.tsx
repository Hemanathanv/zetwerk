import { Badge } from '@/components/ui/badge';
import { intentForStatus, type EwmsIntent } from '@/design-system/componentIntent';

type Status = 'active' | 'inactive' | 'draft' | 'archived' | 'system' | 'custom';

interface AdminStatusBadgeProps {
  status: Status;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<Status, { intent: EwmsIntent; label: string }> = {
  active: { intent: intentForStatus('active'), label: 'Active' },
  inactive: { intent: intentForStatus('inactive'), label: 'Inactive' },
  draft: { intent: intentForStatus('draft'), label: 'Draft' },
  archived: { intent: intentForStatus('archived'), label: 'Archived' },
  system: { intent: intentForStatus('system'), label: 'System' },
  custom: { intent: intentForStatus('custom'), label: 'Custom' },
};

export function AdminStatusBadge({ status, size = 'md' }: AdminStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.inactive;
  return <Badge intent={cfg.intent} size={size === 'sm' ? 'sm' : 'default'}>{cfg.label}</Badge>;
}
