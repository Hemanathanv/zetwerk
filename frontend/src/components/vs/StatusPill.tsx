import { Badge } from '@/components/ui/badge';
import { intentForStatus, type EwmsIntent } from '@/design-system/componentIntent';

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
  variant?: PillVariant;
};

const variantIntent: Record<PillVariant, EwmsIntent> = {
  transit: 'info',
  port: 'warning',
  cleared: 'success',
  blocked: 'danger',
  validated: 'success',
  pending: 'neutral',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
  info: 'info',
};

export function StatusPill({ status, variant }: StatusPillProps) {
  return <Badge intent={variant ? variantIntent[variant] : intentForStatus(status)} size="sm">{status}</Badge>;
}
