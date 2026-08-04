import { Badge } from '@/components/ui/badge';
import { intentForStatus, type EwmsIntent } from '@/design-system/componentIntent';

type StatusIndicatorProps = {
  status: string;
  intent?: EwmsIntent;
  size?: 'default' | 'sm';
  className?: string;
};

export function StatusIndicator({ status, intent, size = 'sm', className }: StatusIndicatorProps) {
  return (
    <Badge intent={intent ?? intentForStatus(status)} size={size} hasDot className={className}>
      {status}
    </Badge>
  );
}
