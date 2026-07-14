import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_WIDTHS: Record<ModalSize, number> = {
  sm: 400, md: 520, lg: 680, xl: 880,
};

interface AdminModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function AdminModal({
  open, onClose, title, description,
  size = 'md', children, footer,
}: AdminModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        style={{
          maxWidth: SIZE_WIDTHS[size],
          width: '100%',
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        <DialogHeader style={{ padding: '24px 24px 0 24px', flexShrink: 0 }}>
          <DialogTitle style={{ fontSize: 18, fontWeight: 700 }}>{title}</DialogTitle>
          {description && (
            <DialogDescription style={{ fontSize: 14.5, marginTop: 4 }}>
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 24px',
            minHeight: 0,
          }}
        >
          {children}
        </div>

        {footer && (
          <div
            style={{
              flexShrink: 0,
              borderTop: '1px solid hsl(var(--border))',
              padding: '16px 24px',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
            }}
          >
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
