import { AlertTriangle } from 'lucide-react';
import type { OcrStatus } from '@/hooks/useDocumentStatus';

interface Props {
  status: OcrStatus | null;
  isStalled?: boolean;
  className?: string;
}

type Config = {
  label: string;
  bg: string;
  color: string;
  pulse?: boolean;
  dot?: string;
  icon?: 'warning';
};

const STATUS_CONFIG: Record<OcrStatus, Config> = {
  UPLOADED: {
    label: 'Uploaded',
    bg: 'hsl(220 14% 94%)',
    color: 'hsl(220 14% 40%)',
    dot: 'hsl(220 14% 60%)',
  },
  QUEUED: {
    label: 'Queued',
    bg: 'hsla(38,92%,50%,0.12)',
    color: 'hsl(38 80% 30%)',
    dot: 'hsl(38 92% 50%)',
  },
  PROCESSING: {
    label: 'Processing',
    bg: 'hsla(217,91%,60%,0.12)',
    color: 'hsl(217 70% 35%)',
    dot: 'hsl(217 91% 55%)',
    pulse: true,
  },
  EXTRACTED: {
    label: 'Extracted',
    bg: 'hsla(173,58%,39%,0.10)',
    color: 'hsl(173 58% 28%)',
    dot: 'hsl(var(--vs-teal))',
  },
  FAILED: {
    label: 'Failed',
    bg: 'hsla(0,84%,60%,0.10)',
    color: 'hsl(0 72% 38%)',
    dot: 'hsl(0 84% 55%)',
  },
  ERROR: {
    label: 'Error',
    bg: 'hsla(0,84%,60%,0.10)',
    color: 'hsl(0 72% 38%)',
    dot: 'hsl(0 84% 55%)',
  },
  FAILED_PERMANENTLY: {
    label: 'Failed permanently',
    bg: 'hsla(0,84%,60%,0.10)',
    color: 'hsl(0 72% 38%)',
    dot: 'hsl(0 84% 55%)',
  },
};

const STALLED_CONFIG: Config = {
  label: 'Stalled',
  bg: 'hsla(38,92%,50%,0.12)',
  color: 'hsl(28 80% 30%)',
  dot: 'hsl(28 92% 50%)',
  icon: 'warning',
};

const LOADING_CONFIG: Config = {
  label: 'Loading…',
  bg: 'hsl(220 14% 94%)',
  color: 'hsl(220 14% 50%)',
  dot: 'hsl(220 14% 70%)',
};

export function DocumentStatusBadge({ status, isStalled = false, className = '' }: Props) {
  const cfg = isStalled ? STALLED_CONFIG : (status ? STATUS_CONFIG[status] : LOADING_CONFIG);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold select-none ${className}`}
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.icon === 'warning' ? (
        <AlertTriangle size={10} style={{ flexShrink: 0, color: cfg.color }} />
      ) : (
        <span className="relative flex h-2 w-2 flex-shrink-0">
          {cfg.pulse && (
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ background: cfg.dot }}
            />
          )}
          <span
            className="relative inline-flex rounded-full h-2 w-2"
            style={{ background: cfg.dot }}
          />
        </span>
      )}
      {cfg.label}
    </span>
  );
}
