import { StatusIndicator } from '@/components/ewms';

type StatusBadgeProps = {
  status: string;
  size?: 'sm' | 'md';
};

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const displayStatus = (status || 'unknown').replace(/_/g, ' ');

  return (
    <StatusIndicator
      status={displayStatus}
      size={size === 'md' ? 'default' : 'sm'}
      data-testid={`status-badge-${status}`}
    />
  );
}
