import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { OcrStatus } from '@/hooks/useDocumentStatus';
import type { EwmsIntent } from '@/design-system/componentIntent';

interface Props {
  status: OcrStatus | null;
  isStalled?: boolean;
  className?: string;
}

type Config = {
  label: string;
  intent: EwmsIntent;
  pulse?: boolean;
  icon?: 'warning';
};

const STATUS_CONFIG: Record<OcrStatus, Config> = {
  UPLOADED: { label: 'Uploaded', intent: 'neutral' },
  QUEUED: { label: 'Queued', intent: 'warning' },
  PROCESSING: { label: 'Processing', intent: 'info', pulse: true },
  EXTRACTED: { label: 'Extracted', intent: 'success' },
  FAILED: { label: 'Failed', intent: 'danger' },
  ERROR: { label: 'Error', intent: 'danger' },
  FAILED_PERMANENTLY: { label: 'Failed permanently', intent: 'danger' },
};

const STALLED_CONFIG: Config = {
  label: 'Stalled',
  intent: 'warning',
  icon: 'warning',
};

const LOADING_CONFIG: Config = {
  label: 'Loading...',
  intent: 'neutral',
};

export function DocumentStatusBadge({ status, isStalled = false, className = '' }: Props) {
  const cfg = isStalled ? STALLED_CONFIG : (status ? STATUS_CONFIG[status] : LOADING_CONFIG);

  return (
    <Badge
      intent={cfg.intent}
      size="sm"
      hasDot={cfg.icon !== 'warning'}
      leadingIcon={cfg.icon === 'warning' ? <AlertTriangle className="size-3" /> : undefined}
      className={className}
    >
      {cfg.pulse && <span className="sr-only">Processing</span>}
      {cfg.label}
    </Badge>
  );
}
