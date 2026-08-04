import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { FileText, Maximize2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn('grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground', className)}>
      <span className="grid grid-cols-2 gap-0.5">
        <span className="size-2 rounded-sm bg-current" />
        <span className="size-2 rounded-sm bg-current opacity-80" />
        <span className="size-2 rounded-sm bg-current opacity-80" />
        <span className="size-2 rounded-sm bg-current" />
      </span>
    </span>
  );
}

export function LogoRow({ label = 'EWMS', subtitle }: { label?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <div>
        <div className="text-sm font-semibold tracking-[0.18em]">{label}</div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  );
}

export function DocViewer({ title = 'Document preview', children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="relative min-h-[420px] overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm font-medium">
        <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
        {title}
      </div>
      <div className="grid min-h-[360px] place-items-center bg-muted/30">{children ?? <span className="text-sm text-muted-foreground">Preview area</span>}</div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-popover px-2 py-1 shadow-md">
        <Button variant="ghost" size="icon" aria-label="Zoom out"><Minus className="size-4" /></Button>
        <Separator orientation="vertical" className="h-5" />
        <span className="w-12 text-center text-xs font-medium">100%</span>
        <Separator orientation="vertical" className="h-5" />
        <Button variant="ghost" size="icon" aria-label="Zoom in"><Plus className="size-4" /></Button>
        <Button variant="ghost" size="icon" aria-label="Fullscreen"><Maximize2 className="size-4" /></Button>
      </div>
    </div>
  );
}

export function EwmsScrollArea({
  as: Component = 'div',
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: ElementType; children: ReactNode }) {
  return (
    <Component className={cn('ewms-scrollarea', className)} {...props}>
      {children}
    </Component>
  );
}

export function EwmsScrollbar() {
  return (
    <div className="h-24 w-2 rounded-full bg-muted">
      <div className="h-10 rounded-full bg-muted-foreground/60" />
    </div>
  );
}
