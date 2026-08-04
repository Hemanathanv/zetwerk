import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EwmsIntent } from '@/design-system/componentIntent';
import { cn } from '@/lib/utils';

const bannerClasses: Record<EwmsIntent, string> = {
  neutral: 'bg-muted text-foreground',
  info: 'bg-[hsl(var(--vs-info)/0.10)] text-[hsl(var(--vs-info))]',
  warning: 'bg-[hsl(var(--vs-warning)/0.12)] text-[hsl(var(--vs-warning))]',
  danger: 'bg-[hsl(var(--destructive)/0.10)] text-destructive',
  success: 'bg-[hsl(var(--vs-success)/0.12)] text-[hsl(var(--vs-success))]',
  active: 'bg-[hsl(var(--primary)/0.10)] text-primary',
  draft: 'bg-muted text-foreground',
};

const iconByIntent = {
  neutral: null,
  info: Info,
  warning: AlertTriangle,
  danger: AlertCircle,
  success: CheckCircle,
  active: Info,
  draft: Info,
};

export function Banner({
  intent = 'neutral',
  children,
  link,
  secondaryAction,
  onClose,
  className,
}: {
  intent?: EwmsIntent;
  children: ReactNode;
  link?: ReactNode;
  secondaryAction?: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  const Icon = iconByIntent[intent];
  return (
    <div className={cn('flex items-center gap-3 rounded-lg px-4 py-3 text-sm', bannerClasses[intent], className)}>
      {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">{children}</div>
      {link}
      {secondaryAction}
      {onClose && (
        <Button type="button" variant="ghost" size="icon" aria-label="Close banner" onClick={onClose}>
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
